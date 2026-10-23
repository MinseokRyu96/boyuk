import { readFileSync, readdirSync } from "node:fs";
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
  // Supabase에 기본으로 있는 역할을 흉내 낸다. service_role은 행 단위 보안을 우회한다
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`);
  // 마이그레이션을 번호 순서대로 모두 적용한다 (실제 DB에 적용한 상태와 같게)
  const migrations = join(__dirname, "migrations");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrations, file), "utf8"));
  }
  // 스키마 사용 권한만 Supabase 기본값을 흉내 낸다. 테이블 권한은 마이그레이션 SQL이 스스로 부여해야 한다
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);

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

  it("anon은 jobs를 읽기만 하고 쓸 수 없다", async () => {
    await db.exec(`set role anon`);
    await expect(db.query(`insert into jobs (source, source_id, title, url) values ('x', 'x', 'x', 'https://x')`)).rejects.toThrow();
    await expect(db.query(`update jobs set title = 'x'`)).rejects.toThrow();
    await expect(db.query(`delete from jobs`)).rejects.toThrow();
  });

  it("service_role은 jobs·collector_runs에 쓰고 마감 처리 함수를 실행할 수 있다 (수집기가 쓰는 권한)", async () => {
    await db.exec(`reset role`);
    await db.exec(`set role service_role`);
    await db.query(`insert into jobs (source, source_id, title, url) values ('work24', 'SR1', '신입 담임', 'https://x/SR1')`);
    await db.query(`update jobs set title = '수정' where source_id = 'SR1'`);
    await db.query(`insert into collector_runs (source, status) values ('work24', 'success')`);
    const { rows } = await db.query<{ n: number }>(`select deactivate_expired_jobs() as n`);
    expect(rows[0].n).toBeGreaterThanOrEqual(0);
    await db.exec(`reset role`);
    await db.exec(`set role anon`);
  });
});

describe("위치 (0002_locations)", () => {
  type PointRow = { group_key: string; org_name: string | null; lat: number | null; lng: number | null };

  async function asServiceRole<T>(run: () => Promise<T>): Promise<T> {
    await db.exec(`reset role`);
    await db.exec(`set role service_role`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
      await db.exec(`set role anon`);
    }
  }

  it("묶인 공고의 위치는 좌표가 있는 행에서 위도·경도를 같은 행에서 가져온다", async () => {
    const week = await kstDay(6);
    await asServiceRole(async () => {
      // 같은 dedupe_key의 두 행: 먼저 수집된 행에는 좌표가 없고, 나중 행에만 있다
      await db.query(
        `insert into jobs (source, source_id, title, org_name, deadline, url, dedupe_key, first_seen_at)
         values ('work24', 'L1', 'L1', '위치어린이집', $1, 'https://x/L1', 'KL', now() - interval '3 hours'),
                ('seoul_center', 'L2', 'L2', '위치어린이집', $1, 'https://x/L2', 'KL', now() - interval '2 hours')`,
        [week],
      );
      await db.query(`update jobs set lat = 37.5665, lng = 126.978, geo_status = 'ok', geo_place = '위치어린이집 · 서울 중구', geocoded_at = now() where source_id = 'L2'`);
    });
    const { rows } = await db.query<PointRow>(`select group_key, org_name, lat, lng from get_feed(null, null, 100) where org_name = '위치어린이집'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(37.5665, 4);
    expect(rows[0].lng).toBeCloseTo(126.978, 3);
  });

  it("좌표가 없는 공고는 위도·경도가 null로 나온다 (기존 공고는 그대로 보인다)", async () => {
    const { rows } = await db.query<PointRow>(`select org_name, lat, lng from get_feed(null, null, 100) where org_name = '해오름어린이집'`);
    expect(rows).toHaveLength(2); // 0001 시험 자료의 해오름어린이집 묶음 두 개
    expect(rows.every((r) => r.lat === null && r.lng === null)).toBe(true);
  });

  it("anon은 jobs의 위치 열도 읽을 수 있고, 쓸 수는 없다", async () => {
    const { rows } = await db.query<{ n: number }>(`select count(lat)::int as n from jobs`);
    expect(rows[0].n).toBeGreaterThan(0);
    await expect(db.query(`update jobs set lat = 37.5, lng = 127`)).rejects.toThrow();
  });

  it("한반도 밖의 좌표, 위도만 있는 좌표, 위치 없이 'ok'인 행, 알 수 없는 상태는 저장되지 않는다", async () => {
    await asServiceRole(async () => {
      await expect(db.query(`update jobs set lat = 10, lng = 127 where source_id = 'L1'`)).rejects.toThrow();
      await expect(db.query(`update jobs set lat = 37.5 where source_id = 'L1'`)).rejects.toThrow();
      await expect(db.query(`update jobs set geo_status = 'ok' where source_id = 'L1'`)).rejects.toThrow();
      await expect(db.query(`update jobs set geo_status = 'maybe' where source_id = 'L1'`)).rejects.toThrow();
    });
  });

  it("못 찾은 공고는 좌표 없이 'not_found'로 남기고 다시 찾아볼 시각을 적는다", async () => {
    await asServiceRole(async () => {
      await db.query(`update jobs set geo_status = 'not_found', geocoded_at = now() where source_id = 'L1'`);
      const { rows } = await db.query<{ geo_status: string; lat: number | null }>(`select geo_status, lat from jobs where source_id = 'L1'`);
      expect(rows[0]).toEqual({ geo_status: "not_found", lat: null });
    });
  });
});
