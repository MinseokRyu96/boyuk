import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { KakaoApiError, type PlaceFinder } from "./kakao-places";

vi.mock("server-only", () => ({}));
const { geocodePending } = await import("./geocode");

type Row = {
  id: string;
  org_name: string | null;
  region: string | null;
  is_active: boolean;
  first_seen_at: string;
  geo_status: "ok" | "not_found" | null;
  geocoded_at: string | null;
  lat: number | null;
  lng: number | null;
  geo_place: string | null;
};

const NOW = new Date("2026-10-24T03:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let counter = 0;
const job = (org: string | null, region: string | null, extra: Partial<Row> = {}): Row => ({
  id: `id${++counter}`,
  org_name: org,
  region,
  is_active: true,
  first_seen_at: new Date(NOW.getTime() - counter * 60_000).toISOString(),
  geo_status: null,
  geocoded_at: null,
  lat: null,
  lng: null,
  geo_place: null,
  ...extra,
});

/** geocode.ts가 쓰는 supabase-js 호출(select·eq·not·like·is·lt·order·limit·in·update)만 흉내 낸 메모리 DB */
function fakeDb(rows: Row[]) {
  const updates: { ids: string[]; values: Record<string, unknown> }[] = [];
  const failUpdate = { message: "" };

  function query(table: Row[]) {
    const filters: ((r: Row) => boolean)[] = [];
    let max = Infinity;
    let sortKey: keyof Row | null = null;
    let descending = false;
    const q = {
      select: () => q,
      eq: (col: keyof Row, value: unknown) => (filters.push((r) => r[col] === value), q),
      not: (col: keyof Row, op: string, value: unknown) => {
        if (op === "is" && value === null) filters.push((r) => r[col] !== null);
        return q;
      },
      is: (col: keyof Row, value: null) => (filters.push((r) => r[col] === value), q),
      like: (col: keyof Row, pattern: string) => {
        const prefix = pattern.replace("%", "");
        filters.push((r) => typeof r[col] === "string" && (r[col] as string).startsWith(prefix));
        return q;
      },
      lt: (col: keyof Row, value: string) => (filters.push((r) => r[col] !== null && (r[col] as string) < value), q),
      order: (col: keyof Row, opts: { ascending: boolean }) => ((sortKey = col), (descending = !opts.ascending), q),
      limit: (n: number) => ((max = n), q),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        let result = table.filter((r) => filters.every((f) => f(r)));
        if (sortKey) {
          const key = sortKey;
          result = [...result].sort((a, b) => ((a[key] as string) < (b[key] as string) ? -1 : 1) * (descending ? -1 : 1));
        }
        return Promise.resolve({ data: result.slice(0, max), error: null }).then(resolve);
      },
    };
    return q;
  }

  const db = {
    from: () => ({
      select: () => query(rows).select(),
      update: (values: Record<string, unknown>) => ({
        in: async (_col: string, ids: string[]) => {
          if (failUpdate.message) return { error: { message: failUpdate.message } };
          updates.push({ ids, values });
          for (const row of rows) if (ids.includes(row.id)) Object.assign(row, values);
          return { error: null };
        },
      }),
    }),
  };
  return { db: db as unknown as SupabaseClient, updates, rows, failUpdate };
}

const found = (lat: number, lng: number, label = "찾은 곳") => ({ lat, lng, label });

describe("geocodePending", () => {
  it("같은 어린이집(이름+구)은 한 번만 찾아서 모든 공고에 같은 위치를 쓴다", async () => {
    const { db, rows } = fakeDb([job("가나다어린이집", "서울 마포구"), job("가나다어린이집", "서울 마포구"), job("라마바어린이집", "서울 은평구")]);
    const find = vi.fn<PlaceFinder>(async (org) => (org === "가나다어린이집" ? found(37.55, 126.91, "가나다 · 마포") : found(37.6, 126.92)));

    const stats = await geocodePending(db, find, { now: NOW });

    expect(find).toHaveBeenCalledTimes(2);
    expect(stats).toMatchObject({ candidates: 3, places: 2, searched: 2, found: 2, notFound: 0, reused: 0, deferred: 0, errors: 0 });
    expect(rows.filter((r) => r.org_name === "가나다어린이집").every((r) => r.lat === 37.55 && r.geo_status === "ok" && r.geo_place === "가나다 · 마포")).toBe(true);
    expect(rows[0].geocoded_at).toBe(NOW.toISOString());
  });

  it("이미 위치를 찾아 둔 어린이집의 새 공고는 카카오를 부르지 않고 그 위치를 재사용한다", async () => {
    const known = job("가나다어린이집", "서울 마포구", { geo_status: "ok", lat: 37.5, lng: 126.9, geo_place: "예전에 찾은 곳", is_active: false });
    const { db, rows } = fakeDb([known, job("가나다어린이집", "서울 마포구")]);
    const find = vi.fn<PlaceFinder>();

    const stats = await geocodePending(db, find, { now: NOW });

    expect(find).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ reused: 1, searched: 0 });
    expect(rows[1]).toMatchObject({ lat: 37.5, lng: 126.9, geo_status: "ok", geo_place: "예전에 찾은 곳" });
  });

  it("못 찾으면 'not_found'로 남기고, 7일이 지나기 전에는 다시 찾지 않는다", async () => {
    const { db, rows } = fakeDb([job("없는어린이집", "서울 마포구")]);
    const find = vi.fn<PlaceFinder>(async () => null);

    expect(await geocodePending(db, find, { now: NOW })).toMatchObject({ searched: 1, notFound: 1, found: 0 });
    expect(rows[0]).toMatchObject({ geo_status: "not_found", lat: null, geocoded_at: NOW.toISOString() });

    expect(await geocodePending(db, find, { now: new Date(NOW.getTime() + 6 * 86_400_000) })).toMatchObject({ candidates: 0 });
    expect(find).toHaveBeenCalledTimes(1);

    expect(await geocodePending(db, find, { now: new Date(NOW.getTime() + 8 * 86_400_000) })).toMatchObject({ candidates: 1, searched: 1 });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("서울 공고, 활성 공고, 어린이집 이름이 있는 공고만 대상이다", async () => {
    const { db } = fakeDb([
      job("경기어린이집", "경기 성남시"),
      job("지역없는어린이집", null),
      job("비활성어린이집", "서울 마포구", { is_active: false }),
      job(null, "서울 마포구"),
      job("대상어린이집", "서울 마포구"),
      job("찾아둔어린이집", "서울 마포구", { geo_status: "ok", lat: 37.5, lng: 126.9 }),
    ]);
    const find = vi.fn<PlaceFinder>(async () => found(37.5, 126.9));

    const stats = await geocodePending(db, find, { now: NOW });

    expect(stats.candidates).toBe(1);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]).toEqual(["대상어린이집", "서울 마포구"]);
  });

  it("한 번에 검색하는 어린이집 수는 limit까지이고 나머지는 다음으로 미룬다 (최근 공고부터)", async () => {
    const { db, rows } = fakeDb(["가", "나", "다", "라"].map((name) => job(`${name}어린이집`, "서울 마포구")));
    const find = vi.fn<PlaceFinder>(async () => found(37.5, 126.9));

    const stats = await geocodePending(db, find, { limit: 2, now: NOW });

    expect(stats).toMatchObject({ places: 4, searched: 2, deferred: 2, found: 2 });
    expect(find.mock.calls.map(([org]) => org)).toEqual(["가어린이집", "나어린이집"]);
    expect(rows.map((r) => r.geo_status)).toEqual(["ok", "ok", null, null]);
  });

  it("연결 오류는 그 어린이집만 건너뛰고(다음에 다시), 연속 3번 나면 멈춘다", async () => {
    const { db, rows } = fakeDb(["가", "나", "다", "라", "마"].map((name) => job(`${name}어린이집`, "서울 마포구")));
    const find = vi.fn<PlaceFinder>(async () => {
      throw new Error("연결 실패");
    });

    const stats = await geocodePending(db, find, { now: NOW });

    expect(find).toHaveBeenCalledTimes(3);
    expect(stats).toMatchObject({ errors: 3, searched: 3, deferred: 2 });
    expect(rows.every((r) => r.geo_status === null)).toBe(true); // 못 찾은 것으로 기록하지 않는다
  });

  it("중간에 한 번 성공하면 연속 오류 횟수를 다시 센다", async () => {
    const { db } = fakeDb(["가", "나", "다", "라", "마"].map((name) => job(`${name}어린이집`, "서울 마포구")));
    const answers: (Error | null)[] = [new Error("x"), new Error("x"), null, new Error("x"), new Error("x")];
    const find = vi.fn<PlaceFinder>(async () => {
      const next = answers.shift();
      if (next) throw next;
      return found(37.5, 126.9);
    });

    const stats = await geocodePending(db, find, { now: NOW });
    expect(find).toHaveBeenCalledTimes(5);
    expect(stats).toMatchObject({ errors: 4, found: 1 });
  });

  it("카카오 키·권한·한도 오류는 그대로 던져 나머지를 멈추고, 아무것도 기록하지 않는다", async () => {
    const { db, rows } = fakeDb([job("가나다어린이집", "서울 마포구"), job("라마바어린이집", "서울 마포구")]);
    const find = vi.fn<PlaceFinder>(async () => {
      throw new KakaoApiError("키가 올바르지 않아요", 401);
    });
    await expect(geocodePending(db, find, { now: NOW })).rejects.toBeInstanceOf(KakaoApiError);
    expect(find).toHaveBeenCalledTimes(1);
    expect(rows.every((r) => r.geo_status === null)).toBe(true);
  });

  it("저장에 실패하면 오류를 던진다", async () => {
    const { db, failUpdate } = fakeDb([job("가나다어린이집", "서울 마포구")]);
    failUpdate.message = "permission denied";
    await expect(geocodePending(db, async () => found(37.5, 126.9), { now: NOW })).rejects.toThrow(/permission denied/);
  });

  it("대상이 없으면 카카오를 부르지 않는다", async () => {
    const { db } = fakeDb([job("찾아둔어린이집", "서울 마포구", { geo_status: "ok", lat: 37.5, lng: 126.9, geocoded_at: daysAgo(1) })]);
    const find = vi.fn<PlaceFinder>();
    expect(await geocodePending(db, find, { now: NOW })).toMatchObject({ candidates: 0, searched: 0 });
    expect(find).not.toHaveBeenCalled();
  });
});
