import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { CollectResult, Collector, RawJob } from "./types";

// run.ts는 서버에서만 쓰도록 server-only를 가져온다. 시험에서는 막지 않는다
vi.mock("server-only", () => ({}));
const { runCollector } = await import("./run");

/** 호출 내용을 기록하는 가짜 Supabase 클라이언트. 실패를 흉내 낼 수도 있다 */
function fakeDb(failures: { upsert?: string; gone?: string; rpc?: string; insert?: string } = {}) {
  const calls = {
    upserts: [] as { rows: Record<string, unknown>[]; options: unknown }[],
    updates: [] as { values: unknown; filters: unknown[] }[],
    rpcs: [] as string[],
    runs: [] as Record<string, unknown>[],
  };
  const db = {
    from(table: string) {
      return {
        upsert: async (rows: Record<string, unknown>[], options: unknown) => {
          if (table === "jobs") calls.upserts.push({ rows, options });
          return { error: failures.upsert ? { message: failures.upsert } : null };
        },
        insert: async (row: Record<string, unknown>) => {
          calls.runs.push(row);
          return { error: failures.insert ? { message: failures.insert } : null };
        },
        update: (values: unknown) => {
          const filters: unknown[] = [];
          const chain = {
            eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), chain),
            lt: async (column: string, value: unknown) => {
              filters.push(["lt", column, value]);
              calls.updates.push({ values, filters });
              return { error: failures.gone ? { message: failures.gone } : null };
            },
          };
          return chain;
        },
      };
    },
    rpc: async (name: string) => {
      calls.rpcs.push(name);
      return { data: 0, error: failures.rpc ? { message: failures.rpc } : null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const job = (id: string, title: string, extra: Partial<RawJob> = {}): RawJob => ({
  sourceId: id,
  title,
  url: `https://example.com/${id}`,
  // 서울이 아니거나 지역을 모르는 공고는 저장하지 않으므로, 기본값은 서울 공고다
  region: "서울 강서구",
  ...extra,
});

function collectorOf(result: CollectResult | Error, extra: Partial<Collector> = {}): Collector {
  return {
    source: "work24",
    isWorkplace: false,
    fetchJobs: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    ...extra,
  };
}

describe("runCollector", () => {
  it("신입·담임 공고만 (source, source_id) 기준으로 upsert하고 중복 키를 만든다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(
      collectorOf({
        complete: true,
        jobs: [
          job("1", "[신입] 만 1세반 담임교사", { orgName: "해오름어린이집", deadline: "2030-01-31", region: "서울 강서구" }),
          job("2", "담임교사 모집 (경력 3년 이상)", { orgName: "달빛어린이집" }),
          job("3", "조리원 모집 경력무관", { orgName: "별빛어린이집" }),
        ],
      }),
      db,
    );

    expect(result).toMatchObject({ source: "work24", status: "success", fetched: 3, saved: 1 });
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].options).toEqual({ onConflict: "source,source_id" });
    const [row] = calls.upserts[0].rows;
    expect(row).toMatchObject({
      source: "work24",
      source_id: "1",
      title: "[신입] 만 1세반 담임교사",
      org_name: "해오름어린이집",
      region: "서울 강서구",
      deadline: "2030-01-31",
      is_workplace: false,
      is_active: true,
    });
    expect(row.dedupe_key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("서울 공고만 저장한다: 다른 시·도와 지역을 모르는 공고는 저장하지 않는다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(
      collectorOf({
        complete: true,
        jobs: [
          job("seoul", "신입 담임교사", { region: "서울 마포구" }),
          job("seoul-only", "신입 담임교사", { region: "서울" }),
          job("gyeonggi", "신입 담임교사", { region: "경기 성남시" }),
          job("busan", "신입 담임교사", { region: "부산" }),
          job("unknown", "신입 담임교사", { region: undefined }),
        ],
      }),
      db,
    );

    expect(result).toMatchObject({ fetched: 5, saved: 2 });
    expect(calls.upserts[0].rows.map((row) => row.source_id)).toEqual(["seoul", "seoul-only"]);
  });

  it("직장어린이집 운영업체 소스는 is_workplace를 true로 저장한다", async () => {
    const { db, calls } = fakeDb();
    await runCollector(collectorOf({ complete: true, jobs: [job("1", "신입 보육교사")] }, { source: "moamam", isWorkplace: true }), db);
    expect(calls.upserts[0].rows[0]).toMatchObject({ source: "moamam", is_workplace: true });
  });

  it("공고마다 직장어린이집 여부를 알려 주면 수집기 기본값보다 그 값을 따른다", async () => {
    const { db, calls } = fakeDb();
    await runCollector(
      collectorOf({
        complete: true,
        jobs: [job("1", "신입 보육교사", { isWorkplace: true }), job("2", "신입 담임교사", { isWorkplace: false }), job("3", "신입 보육교사 모집")],
      }),
      db,
    );
    const byId = Object.fromEntries(calls.upserts[0].rows.map((row) => [row.source_id, row.is_workplace]));
    expect(byId).toEqual({ "1": true, "2": false, "3": false });
  });

  it("범용 채용 소스는 어린이집이 아닌 담임교사 공고(학원 등)를 저장하지 않는다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(
      collectorOf(
        {
          complete: true,
          jobs: [
            job("1", "초등부 담임교사 (신입 가능)", { orgName: "스마일학원", contextText: "학원" }),
            job("2", "신입 담임교사", { orgName: "별빛어린이집" }),
          ],
        },
        { needsChildcareContext: true },
      ),
      db,
    );
    expect(result.saved).toBe(1);
    expect(calls.upserts[0].rows.map((r) => r.source_id)).toEqual(["2"]);
  });

  it("어린이집 맥락 검사를 요구하지 않는 소스(직장어린이집 사이트 등)는 그대로 저장한다", async () => {
    const { db } = fakeDb();
    const result = await runCollector(collectorOf({ complete: true, jobs: [job("1", "신입 담임교사")] }), db);
    expect(result.saved).toBe(1);
  });

  it("같은 실행에서 같은 공고가 두 번 와도 한 건만 저장한다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(collectorOf({ complete: true, jobs: [job("1", "신입 담임교사"), job("1", "신입 담임교사")] }), db);
    expect(result.saved).toBe(1);
    expect(calls.upserts[0].rows).toHaveLength(1);
  });

  it("전부 가져왔으면 이번 목록에서 사라진 공고를 숨기고, 만료 처리를 실행하고, 성공을 기록한다", async () => {
    const { db, calls } = fakeDb();
    await runCollector(collectorOf({ complete: true, jobs: [job("1", "신입 담임교사")] }), db);

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].values).toEqual({ is_active: false });
    expect(calls.updates[0].filters).toEqual([
      ["eq", "source", "work24"],
      ["eq", "is_active", true],
      ["lt", "last_seen_at", expect.any(String)],
    ]);
    expect(calls.rpcs).toEqual(["deactivate_expired_jobs"]);
    expect(calls.runs).toHaveLength(1);
    expect(calls.runs[0]).toMatchObject({ source: "work24", status: "success", fetched_count: 1, saved_count: 1, error_message: null });
  });

  it("일부만 가져왔으면(complete: false) 사라진 공고를 숨기지 않는다. 만료 처리는 한다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(collectorOf({ complete: false, jobs: [job("1", "신입 담임교사")] }), db);

    expect(result).toMatchObject({ status: "success", partial: true });
    expect(calls.updates).toHaveLength(0);
    expect(calls.rpcs).toEqual(["deactivate_expired_jobs"]);
    expect(calls.runs[0]).toMatchObject({ status: "success", error_message: expect.stringContaining("일부만") });
  });

  it("수집된 공고가 0건이면 실패로 기록하고 아무것도 숨기지 않는다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(collectorOf({ complete: true, jobs: [] }), db);

    expect(result).toMatchObject({ status: "failed", fetched: 0 });
    expect(result.error).toContain("0건");
    expect(calls.upserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
    expect(calls.runs[0]).toMatchObject({ status: "failed", fetched_count: 0 });
  });

  it("수집기가 오류를 던지면 실패로 기록하고 오류를 밖으로 던지지 않는다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(collectorOf(new Error("WORK24_API_KEY 환경변수가 없어요.")), db);

    expect(result).toMatchObject({ status: "failed", error: "WORK24_API_KEY 환경변수가 없어요." });
    expect(calls.updates).toHaveLength(0);
    expect(calls.runs[0]).toMatchObject({ status: "failed", error_message: "WORK24_API_KEY 환경변수가 없어요." });
  });

  it("저장에 실패하면 사라진 공고를 숨기지 않고 실패로 기록한다", async () => {
    const { db, calls } = fakeDb({ upsert: "permission denied" });
    const result = await runCollector(collectorOf({ complete: true, jobs: [job("1", "신입 담임교사")] }), db);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("permission denied");
    expect(calls.updates).toHaveLength(0);
  });

  it("저장할 공고가 하나도 없어도(판별에서 모두 탈락) 사라진 공고 처리는 한다", async () => {
    const { db, calls } = fakeDb();
    const result = await runCollector(collectorOf({ complete: true, jobs: [job("1", "조리원 모집 경력무관")] }), db);
    expect(result).toMatchObject({ status: "success", saved: 0 });
    expect(calls.upserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(1);
  });

  it("실행 기록이 실패해도 수집 결과는 그대로 돌려준다", async () => {
    const { db } = fakeDb({ insert: "db down" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCollector(collectorOf({ complete: true, jobs: [job("1", "신입 담임교사")] }), db);
    expect(result.status).toBe("success");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("collector_runs 기록 실패"));
    log.mockRestore();
  });
});
