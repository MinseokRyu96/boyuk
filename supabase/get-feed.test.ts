import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * 마이그레이션 SQL을 로컬 Postgres(PGlite)에 그대로 적용해 피드 조회·마감 처리·권한을 확인한다.
 * Supabase 프로젝트 없이도 돌아간다.
 */

type FeedRow = {
  group_key: string;
  org_name: string | null;
  url: string;
  sources: string[];
  is_workplace: boolean;
  first_seen_at: Date;
};

let db: PGlite;

const hoursAgo = (h: number) => `now() - interval '${h} hours'`;

async function kstDay(offset: number): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `select (((now() at time zone 'Asia/Seoul')::date) + ${offset})::text as d`,
  );
  return rows[0].d;
}

type Seed = {
  source: string;
  id: string;
  seen: string;
  org?: string;
  deadline?: string;
  key?: string;
  active?: boolean;
  workplace?: boolean;
};

function insert(o: Seed) {
  return db.query(
    `insert into jobs (source, source_id, title, org_name, deadline, url, dedupe_key, is_active, is_workplace, first_seen_at)
     values ($1, $2, $2, $3, $4, 'https://x/' || $2, $5, $6, $7, ${o.seen})`,
    [o.source, o.id, o.org ?? null, o.deadline ?? null, o.key ?? null, o.active ?? true, o.workplace ?? false],
  );
}

async function feed(limit = 100, cursor?: { at: Date; key: string }) {
  const { rows } = await db.query<FeedRow>(`select * from get_feed($1, $2, $3)`, [
    cursor?.at.toISOString() ?? null,
    cursor?.key ?? null,
    limit,
  ]);
  return rows;
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase에 기본으로 있는 역할을 흉내 낸다
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
  await db.exec(readFileSync(join(__dirname, "migrations/0001_init.sql"), "utf8"));
  await db.exec(`grant usage on schema public to anon; grant select on jobs to anon, authenticated;`);

  // 같은 공고: 고용24 A와 서울센터 B가 같은 dedupe_key. 같은 고용24의 C도 같은 키지만 다른 공고다.
  const week = await kstDay(5);
  await insert({ source: "work24", id: "A", org: "해오름어린이집", deadline: week, key: "K1", seen: hoursAgo(2) });
  await insert({ source: "seoul_center", id: "B", org: "해오름어린이집", deadline: week, key: "K1", seen: hoursAgo(1), workplace: true });
  await insert({ source: "work24", id: "C", org: "해오름어린이집", deadline: week, key: "K1", seen: hoursAgo(4) });
  // 어린이집명도 마감일도 없는 공고
  await insert({ source: "saramin", id: "D", seen: hoursAgo(3) });
  // 숨겨져야 하는 공고
  await insert({ source: "work24", id: "E-expired", org: "지난", deadline: await kstDay(-1), key: "KE", seen: hoursAgo(5) });
  await insert({ source: "work24", id: "F-old", org: "오래된", seen: `now() - interval '31 days'` });
  await insert({ source: "work24", id: "G-inactive", org: "비활성", deadline: await kstDay(3), active: false, seen: hoursAgo(6) });
  // 오늘이 마감인 공고는 보여야 한다
  await insert({ source: "work24", id: "H-today", org: "오늘마감", deadline: await kstDay(0), key: "KH", seen: hoursAgo(7) });
  // 같은 시각에 저장된 공고 5건 (한 번의 수집에서 저장된 공고는 first_seen_at이 같다)
  for (const id of ["T1", "T2", "T3", "T4", "T5"]) {
    await insert({ source: "hansol", id, seen: `date_trunc('minute', now() - interval '10 hours')` });
  }

  await db.exec(`set role anon`);
});

afterAll(async () => {
  await db.close();
});

describe("get_feed", () => {
  it("만료된 공고, 30일 지난 상시채용, 비활성 공고는 숨기고 오늘이 마감인 공고는 보인다", async () => {
    const orgs = (await feed()).map((r) => r.org_name);
    expect(orgs).not.toContain("지난");
    expect(orgs).not.toContain("오래된");
    expect(orgs).not.toContain("비활성");
    expect(orgs).toContain("오늘마감");
  });

  it("출처가 다른 같은 공고는 한 카드로 묶고 출처와 직장 여부를 합친다 (F6)", async () => {
    const merged = (await feed()).find((r) => r.sources.length === 2);
    expect(merged?.sources).toEqual(["seoul_center", "work24"]);
    expect(merged?.is_workplace).toBe(true);
    // 같은 출처의 두 공고(A 2시간 전, C 4시간 전) 중 먼저 수집된 C가 첫 순번이라 서울센터 B와 묶인다
    expect(merged?.url).toBe("https://x/C");
  });

  it("같은 출처의 서로 다른 공고는 합치지 않는다", async () => {
    const rows = await feed();
    expect(rows.filter((r) => r.org_name === "해오름어린이집")).toHaveLength(2);
    expect(rows.find((r) => r.url === "https://x/A")?.sources).toEqual(["work24"]);
  });

  it("어린이집명이 없는 공고도 보이고, 최신 등록순으로 정렬한다", async () => {
    const rows = await feed();
    expect(rows.some((r) => r.org_name === null)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].first_seen_at.getTime()).toBeGreaterThanOrEqual(rows[i].first_seen_at.getTime());
    }
  });

  it("같은 시각에 저장된 공고가 페이지 경계에 걸려도 빠지거나 겹치지 않는다", async () => {
    const all = (await feed()).map((r) => r.group_key);
    const paged: string[] = [];
    let cursor: { at: Date; key: string } | undefined;
    for (let guard = 0; guard < 30; guard++) {
      const page = await feed(3, cursor);
      if (page.length === 0) break;
      paged.push(...page.map((r) => r.group_key));
      const last = page[page.length - 1];
      cursor = { at: last.first_seen_at, key: last.group_key };
    }
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(all);
  });
});

describe("권한과 마감 처리", () => {
  it("anon은 collector_runs를 직접 읽거나 마감 처리 함수를 실행할 수 없다", async () => {
    await expect(db.query(`select * from collector_runs`)).rejects.toThrow();
    await expect(db.query(`select deactivate_expired_jobs()`)).rejects.toThrow();
  });

  it("마감 처리는 만료된 공고와 30일 지난 상시채용만 비활성화한다", async () => {
    await db.exec(`reset role`);
    const { rows } = await db.query<{ n: number }>(`select deactivate_expired_jobs() as n`);
    expect(rows[0].n).toBe(2);
    const { rows: still } = await db.query<{ source_id: string }>(`select source_id from jobs where is_active`);
    expect(still.map((r) => r.source_id)).not.toContain("E-expired");
    expect(still.map((r) => r.source_id)).not.toContain("F-old");
    await db.exec(`set role anon`);
  });

  it("last_collected_at은 성공한 실행의 시각만 돌려준다", async () => {
    await db.exec(`reset role`);
    await db.exec(`insert into collector_runs (source, status, started_at) values
      ('work24', 'success', now() - interval '12 minutes'), ('hansol', 'failed', now())`);
    await db.exec(`set role anon`);
    const { rows } = await db.query<{ t: Date }>(`select last_collected_at() as t`);
    const minutes = (Date.now() - rows[0].t.getTime()) / 60000;
    expect(minutes).toBeGreaterThan(11);
    expect(minutes).toBeLessThan(13);
  });
});
