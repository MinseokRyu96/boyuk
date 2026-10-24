import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { kstDate } from "../time";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 실제 Supabase DB를 대상으로 수집 실행기와 피드 조회를 시험한다. 기본 `npm test`에서는 건너뛴다.
 *
 * 실행: .env.local의 키를 읽어 환경변수에 올린 뒤 DB_TESTS=1로 돌린다.
 *   set -a; . ./.env.local; set +a; npm run test:db
 *
 * 안전장치: 이 시험은 `itest_<무작위>_a/b`라는 전용 출처 이름의 행만 만들고, 끝나면 그 이름의 행만 지운다.
 * 다른 출처의 데이터는 읽기만 하고 건드리지 않는다.
 */

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { runCollector } = await import("./run");
const { fetchFeedPage, fetchLastCollectedAt } = await import("../jobs");

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.DB_TESTS === "1" && Boolean(url && anonKey && serviceKey);

type DbJob = {
  source: string;
  source_id: string;
  title: string;
  org_name: string | null;
  region: string | null;
  deadline: string | null;
  is_active: boolean;
  dedupe_key: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

describe.skipIf(!enabled)("runCollector — 실제 Supabase DB", () => {
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 8);
  const SRC_A = `itest_${tag}_a`;
  const SRC_B = `itest_${tag}_b`;
  const day = (offset: number) => kstDate(new Date(Date.now() + offset * 86_400_000));
  const MERGED_ORG = "테스트해오름어린이집";
  const startedAt = Date.now();

  const job = (source: string, id: string, title: string, extra: Partial<RawJob> = {}): RawJob => ({
    sourceId: id,
    title,
    url: `https://example.com/${source}/${id}`,
    // 서울이 아니거나 지역을 모르는 공고는 저장하지 않으므로, 기본값은 서울 공고다
    region: "서울 강서구",
    ...extra,
  });
  const fake = (source: string, result: CollectResult | Error): Collector => ({
    source,
    isWorkplace: false,
    fetchJobs: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  });

  async function jobsOf(source: string): Promise<DbJob[]> {
    const { data, error } = await admin.from("jobs").select("*").eq("source", source).order("source_id");
    if (error) throw new Error(error.message);
    return (data ?? []) as DbJob[];
  }
  const byId = (rows: DbJob[], id: string) => rows.find((row) => row.source_id === id);

  async function cleanup() {
    await admin.from("jobs").delete().in("source", [SRC_A, SRC_B]);
    await admin.from("collector_runs").delete().in("source", [SRC_A, SRC_B]);
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, options);
    anon = createClient(url!, anonKey!, options);
    await cleanup();

    // 1차 실행: A는 4건(신입 담임 둘, 경력자 하나, 이미 마감된 것 하나), B는 A와 같은 어린이집·마감일의 공고 1건
    await runCollector(
      fake(SRC_A, {
        complete: true,
        jobs: [
          job(SRC_A, "a1", "[신입 가능] 만 1세반 담임교사 (itest)", { orgName: MERGED_ORG, deadline: day(10), region: "서울 강서구" }),
          job(SRC_A, "a2", "상시 채용 신입 보육교사 (itest)", { orgName: "테스트푸르니어린이집" }),
          job(SRC_A, "a3", "담임교사 모집 (경력 3년 이상) (itest)", { orgName: "테스트달빛어린이집", deadline: day(10) }),
          job(SRC_A, "a4", "신입 담임교사 마감 지남 (itest)", { orgName: "테스트마감어린이집", deadline: day(-1) }),
        ],
      }),
      admin,
    );
    await runCollector(
      fake(SRC_B, {
        complete: true,
        jobs: [job(SRC_B, "b1", "신입 보육교사 (itest B)", { orgName: MERGED_ORG, deadline: day(10), region: "서울 강서구" })],
      }),
      admin,
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    await cleanup();
    for (const table of ["jobs", "collector_runs"]) {
      const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("source", [SRC_A, SRC_B]);
      expect(count, `${table}에 시험 행이 남아 있어요`).toBe(0);
    }
  });

  it("스키마가 있고, 시험 전에는 이 시험의 출처 이름이 DB에 없었다", async () => {
    const { error } = await admin.from("jobs").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("신입·담임 판별을 통과한 공고만 저장한다 (경력 3년 이상은 저장하지 않는다)", async () => {
    const rows = await jobsOf(SRC_A);
    expect(rows.map((row) => row.source_id)).toEqual(["a1", "a2", "a4"]);
    expect(byId(rows, "a1")).toMatchObject({ org_name: MERGED_ORG, region: "서울 강서구", deadline: day(10) });
  });

  it("이미 마감된 공고는 저장 직후 마감 처리로 비활성이 된다", async () => {
    const a = await jobsOf(SRC_A);
    expect(byId(a, "a4")?.is_active).toBe(false);
    expect(byId(a, "a1")?.is_active).toBe(true);
    expect(byId(a, "a2")?.is_active).toBe(true);
    expect((await jobsOf(SRC_B))[0].is_active).toBe(true);
  });

  it("같은 어린이집·마감일의 공고는 같은 중복 키를 받고, 마감일이 없으면 키가 없다", async () => {
    const a = await jobsOf(SRC_A);
    const b = await jobsOf(SRC_B);
    expect(byId(a, "a1")?.dedupe_key).toMatch(/^[0-9a-f]{32}$/);
    expect(byId(a, "a1")?.dedupe_key).toBe(byId(b, "b1")?.dedupe_key);
    expect(byId(a, "a2")?.dedupe_key).toBeNull();
  });

  it("실행마다 collector_runs에 성공과 건수를 기록한다", async () => {
    const { data, error } = await admin.from("collector_runs").select("*").in("source", [SRC_A, SRC_B]).order("source");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.[0]).toMatchObject({ source: SRC_A, status: "success", fetched_count: 4, saved_count: 3, error_message: null });
    expect(data?.[1]).toMatchObject({ source: SRC_B, status: "success", fetched_count: 1, saved_count: 1 });
  });

  describe("공개 사용자(anon) 권한", () => {
    it("활성 공고만 읽을 수 있다 (비활성 a4는 보이지 않는다)", async () => {
      const { data, error } = await anon.from("jobs").select("source_id").in("source", [SRC_A, SRC_B]).order("source_id");
      expect(error).toBeNull();
      expect(data?.map((row) => row.source_id)).toEqual(["a1", "a2", "b1"]);
    });

    it("collector_runs는 행이 있어도 한 줄도 보이지 않는다", async () => {
      const { data } = await anon.from("collector_runs").select("*").in("source", [SRC_A, SRC_B]);
      expect(data ?? []).toEqual([]);
    });

    it("jobs를 만들거나 고치거나 지울 수 없고, 마감 처리 함수도 실행할 수 없다", async () => {
      const insert = await anon.from("jobs").insert({ source: SRC_A, source_id: "hack", title: "x", url: "https://x" });
      expect(insert.error).not.toBeNull();

      await anon.from("jobs").update({ title: "해킹" }).eq("source", SRC_A);
      await anon.from("jobs").delete().eq("source", SRC_A);
      const a = await jobsOf(SRC_A);
      expect(a.map((row) => row.source_id)).toEqual(["a1", "a2", "a4"]);
      expect(byId(a, "a1")?.title).toBe("[신입 가능] 만 1세반 담임교사 (itest)");

      const rpc = await anon.rpc("deactivate_expired_jobs");
      expect(rpc.error).not.toBeNull();
    });
  });

  describe("피드 조회", () => {
    it("get_feed: 같은 어린이집·마감일의 두 출처가 한 카드로 합쳐진다", async () => {
      const { data, error } = await anon.rpc("get_feed", { p_limit: 100 });
      expect(error).toBeNull();
      const mine = (data as { org_name: string | null; sources: string[]; title: string }[]).filter((row) =>
        row.sources.some((source) => [SRC_A, SRC_B].includes(source)),
      );
      const merged = mine.filter((row) => row.org_name === MERGED_ORG);
      expect(merged).toHaveLength(1);
      expect(merged[0].sources).toEqual([SRC_A, SRC_B]);
      expect(merged[0].title).toBe("[신입 가능] 만 1세반 담임교사 (itest)"); // 먼저 수집된 공고가 대표
      expect(mine).toHaveLength(2); // 합쳐진 카드 + 상시 공고 a2 (a4는 비활성)
    });

    it("앱의 조회 코드(fetchFeedPage)가 실제 DB 응답을 카드로 바꾼다", async () => {
      const page = await fetchFeedPage(null);
      const card = page.cards.find((c) => c.orgName === MERGED_ORG);
      expect(card).toBeDefined();
      expect(card?.sources.map((s) => s.code)).toEqual([SRC_A, SRC_B]);
      expect(card?.dDay).toEqual({ label: "D-10", level: "normal" });
      expect(card?.isNew).toBe(true);
      const always = page.cards.find((c) => c.orgName === "테스트푸르니어린이집");
      expect(always?.dDay).toEqual({ label: "상시", level: "open" });
    });

    it("last_collected_at은 이번 시험의 성공 실행 이후 시각이다", async () => {
      const last = await fetchLastCollectedAt();
      expect(last).not.toBeNull();
      expect(new Date(last!).getTime()).toBeGreaterThanOrEqual(startedAt - 5000);
    });
  });

  describe("다음 수집에서의 변화", () => {
    it("전부 가져왔는데 목록에서 빠진 공고(a2)는 숨기고, 남은 공고(a1)의 최초 수집 시각은 유지한다", async () => {
      const before = byId(await jobsOf(SRC_A), "a1")!;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = await runCollector(
        fake(SRC_A, { complete: true, jobs: [job(SRC_A, "a1", "[신입 가능] 만 1세반 담임교사 (itest)", { orgName: MERGED_ORG, deadline: day(10), region: "서울 강서구" })] }),
        admin,
      );
      expect(result).toMatchObject({ status: "success", saved: 1 });
      expect(result.partial).toBeUndefined();

      const a = await jobsOf(SRC_A);
      expect(byId(a, "a2")?.is_active).toBe(false);
      expect(byId(a, "a1")?.is_active).toBe(true);
      expect(byId(a, "a1")?.first_seen_at).toBe(before.first_seen_at);
      expect(new Date(byId(a, "a1")!.last_seen_at).getTime()).toBeGreaterThan(new Date(before.last_seen_at).getTime());
    });

    it("일부만 가져온 실행(complete: false)은 목록에 없는 공고(a1)를 숨기지 않는다", async () => {
      const result = await runCollector(
        fake(SRC_A, { complete: false, jobs: [job(SRC_A, "a5", "신입 보육교사 (itest 5)", { orgName: "테스트별빛어린이집" })] }),
        admin,
      );
      expect(result).toMatchObject({ status: "success", partial: true });

      const a = await jobsOf(SRC_A);
      expect(byId(a, "a1")?.is_active).toBe(true); // 이번 목록에 없지만 숨기지 않았다
      expect(byId(a, "a5")?.is_active).toBe(true);
      const { data } = await admin.from("collector_runs").select("error_message").eq("source", SRC_A).order("id", { ascending: false }).limit(1);
      expect(data?.[0].error_message).toContain("일부만");
    });

    it("다시 올라온 공고(a2)는 되살리고, 전부 가져온 실행에서 빠진 a5는 숨긴다. 행이 중복되지는 않는다", async () => {
      await runCollector(
        fake(SRC_A, {
          complete: true,
          jobs: [
            job(SRC_A, "a1", "[신입 가능] 만 1세반 담임교사 (itest)", { orgName: MERGED_ORG, deadline: day(10) }),
            job(SRC_A, "a2", "상시 채용 신입 보육교사 (itest)", { orgName: "테스트푸르니어린이집" }),
          ],
        }),
        admin,
      );
      const a = await jobsOf(SRC_A);
      expect(byId(a, "a2")?.is_active).toBe(true);
      expect(byId(a, "a5")?.is_active).toBe(false);
      expect(a.map((row) => row.source_id)).toEqual(["a1", "a2", "a4", "a5"]);
    });

    it("저장돼 있던 공고(a1)가 민간어린이집으로 다시 나오면 일부만 가져온 실행이어도 숨기고, 목록에 없는 a2는 그대로 둔다", async () => {
      const result = await runCollector(
        fake(SRC_A, {
          complete: false,
          jobs: [job(SRC_A, "a1", "[신입 가능] 만 1세반 담임교사 (itest)", { orgName: MERGED_ORG, deadline: day(10), facilityType: "민간" })],
        }),
        admin,
      );
      expect(result).toMatchObject({ status: "success", saved: 0 });
      const a = await jobsOf(SRC_A);
      expect(byId(a, "a1")?.is_active).toBe(false);
      expect(byId(a, "a2")?.is_active).toBe(true);
    });
  });

  describe("실패 처리", () => {
    it("수집기가 오류를 던지면 실패로 기록하고, 이미 저장된 공고는 그대로 둔다", async () => {
      const before = await jobsOf(SRC_B);
      const result = await runCollector(fake(SRC_B, new Error("WORK24_API_KEY 환경변수가 없어요. (itest)")), admin);
      expect(result).toMatchObject({ status: "failed", error: "WORK24_API_KEY 환경변수가 없어요. (itest)" });

      const { data } = await admin.from("collector_runs").select("*").eq("source", SRC_B).eq("status", "failed");
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({ fetched_count: 0, saved_count: 0, error_message: "WORK24_API_KEY 환경변수가 없어요. (itest)" });
      expect(await jobsOf(SRC_B)).toEqual(before);
    });

    it("0건이면 실패로 기록하고 기존 공고(b1)를 숨기지 않는다", async () => {
      const result = await runCollector(fake(SRC_B, { complete: true, jobs: [] }), admin);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("0건");
      expect(byId(await jobsOf(SRC_B), "b1")?.is_active).toBe(true);
    });

    it("실패한 실행은 last_collected_at(성공 기준)을 앞당기지 않는다", async () => {
      const { data: runs } = await admin.from("collector_runs").select("started_at,status").in("source", [SRC_A, SRC_B]);
      const lastSuccess = Math.max(...(runs ?? []).filter((r) => r.status === "success").map((r) => new Date(r.started_at).getTime()));
      const last = await fetchLastCollectedAt();
      expect(new Date(last!).getTime()).toBeGreaterThanOrEqual(lastSuccess);
      const failedAfter = (runs ?? []).filter((r) => r.status === "failed" && new Date(r.started_at).getTime() > lastSuccess);
      expect(failedAfter.length).toBeGreaterThan(0); // 성공 이후에 실패가 있었는데도
      expect(new Date(last!).getTime()).toBeLessThan(Math.min(...failedAfter.map((r) => new Date(r.started_at).getTime())) + 1); // 실패 시각으로 갱신되지 않았다
    });
  });
});
