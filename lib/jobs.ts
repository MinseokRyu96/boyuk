import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE, encodeCursor, paginateRows, type Cursor } from "./cursor";
import { districtOf } from "./districts";
import { toCard } from "./feed";
import { hasFilters, matchesFilters, type FeedFilters } from "./filters";
import { buildSampleRows } from "./sample-jobs";
import { isSourceCode } from "./sources";
import { paginateByDeadline, type FeedSort } from "./sort";
import { getPublicClient } from "./supabase";
import type { FeedCounts, FeedPage, FeedRow, MapData } from "./types";

/** Supabase가 연결되어 있지 않으면 샘플 데이터로 동작한다 */
export function isSampleMode(): boolean {
  return getPublicClient() === null;
}

/** get_feed가 한 번에 돌려주는 최대 건수 (SQL이 100으로 자른다) */
const SCAN_SIZE = 100;
/** 공고를 전부 모을 때 훑는 최대 횟수. 지금 공고 수(수백 건)보다 훨씬 크고, 잘못된 조건이 DB를 오래 붙잡지 못하게 한다 */
const MAX_SCAN_BATCHES = 10;

async function rpcFeed(client: SupabaseClient, cursor: Cursor | null, limit: number): Promise<FeedRow[]> {
  const { data, error } = await client.rpc("get_feed", {
    p_cursor_at: cursor?.at ?? null,
    p_cursor_key: cursor?.key ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(`공고를 불러오지 못했어요: ${error.message}`);
  return (data ?? []) as FeedRow[];
}

const cursorOf = (row: FeedRow): Cursor => ({ at: row.first_seen_at, key: row.group_key });

/** 조건에 맞는 공고 전부를 최신순으로 모은다. 훑는 상한(MAX_SCAN_BATCHES × 100건)을 넘는 공고는 빠진다 */
async function scanAll(client: SupabaseClient, filters: FeedFilters): Promise<FeedRow[]> {
  const found: FeedRow[] = [];
  let cursor: Cursor | null = null;
  for (let batch = 0; batch < MAX_SCAN_BATCHES; batch++) {
    const rows = await rpcFeed(client, cursor, SCAN_SIZE);
    for (const row of rows) if (matchesFilters(row, filters)) found.push(row);
    if (rows.length < SCAN_SIZE) break;
    cursor = cursorOf(rows[rows.length - 1]);
  }
  return found;
}

/**
 * 커서 다음 공고 PAGE_SIZE건.
 * filters로 서울의 구와 수집 출처(플랫폼)를 고를 수 있고(둘을 함께 걸면 둘 다 만족해야 한다), 비우면 모든 공고다.
 * sort가 soon·late(마감 임박순·늦은순)이면 마감일 순으로 돌려준다.
 *
 * get_feed는 지역·출처 조건과 마감일 정렬을 지원하지 않는다(SQL을 바꾸면 마이그레이션을 따로 적용해야 한다).
 * 그래서 필터나 마감일 정렬이 걸리면 공고 전체를 모아 서버에서 거르고 정렬한 뒤 잘라 준다. 이때 조건에 맞는 전체 건수(total)도 함께 돌려준다.
 * 마감일 정렬의 커서는 마감일을 담은 전용이라 최신순 커서와 섞어 쓰지 않는다 (lib/cursor.ts).
 * 필터도 정렬도 없는 기본 화면은 DB에서 한 쪽만 읽는 빠른 길을 쓴다.
 */
export async function fetchFeedPage(
  cursor: Cursor | null,
  now: Date = new Date(),
  filters: FeedFilters = {},
  sort: FeedSort = "new",
): Promise<FeedPage> {
  const client = getPublicClient();
  const filtered = hasFilters(filters) || sort !== "new";

  if (client && !filtered) {
    const rows = await rpcFeed(client, cursor, PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      cards: page.map((row) => toCard(row, now)),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(cursorOf(last)) : null,
    };
  }

  const rows = client ? await scanAll(client, filters) : buildSampleRows(now).filter((row) => matchesFilters(row, filters));
  const page = sort === "new" ? paginateRows(rows, cursor, PAGE_SIZE) : paginateByDeadline(rows, cursor, sort, PAGE_SIZE);
  return { cards: page.rows.map((row) => toCard(row, now)), nextCursor: page.nextCursor, total: rows.length };
}

/**
 * 지도에 찍을 공고. 조건(구·출처)에 맞는 공고 중 위치를 찾은 것만 points에 담고, 전체 건수도 함께 돌려준다.
 * 위치는 get_feed가 돌려주는 lat·lng이다 (0002 마이그레이션 전에는 없어서 points가 비어 있다).
 * 샘플 데이터에는 위치가 없어서 지도가 비어 있다.
 */
export async function fetchMapData(now: Date = new Date(), filters: FeedFilters = {}): Promise<MapData> {
  const client = getPublicClient();
  const rows = client ? await scanAll(client, filters) : buildSampleRows(now).filter((row) => matchesFilters(row, filters));
  const points = rows.flatMap((row) =>
    typeof row.lat === "number" && typeof row.lng === "number" ? [{ ...toCard(row, now), lat: row.lat, lng: row.lng }] : [],
  );
  return { points, total: rows.length };
}

/** 지금 보이는 공고의 구별·출처별 건수. 필터 칩에 숫자를 붙이는 데 쓴다 */
export async function fetchFeedCounts(now: Date = new Date()): Promise<FeedCounts> {
  const counts: FeedCounts = { total: 0, byDistrict: {}, bySource: {} };
  const tally = (rows: FeedRow[]) => {
    for (const row of rows) {
      counts.total++;
      const gu = districtOf(row.region);
      if (gu) counts.byDistrict[gu] = (counts.byDistrict[gu] ?? 0) + 1;
      for (const code of row.sources) {
        if (isSourceCode(code)) counts.bySource[code] = (counts.bySource[code] ?? 0) + 1;
      }
    }
  };

  const client = getPublicClient();
  if (!client) {
    tally(buildSampleRows(now));
    return counts;
  }

  let cursor: Cursor | null = null;
  for (let batch = 0; batch < MAX_SCAN_BATCHES; batch++) {
    const rows = await rpcFeed(client, cursor, SCAN_SIZE);
    tally(rows);
    if (rows.length < SCAN_SIZE) break;
    cursor = cursorOf(rows[rows.length - 1]);
  }
  return counts;
}

/** 성공한 가장 최근 수집 시각(ISO). 아직 수집한 적이 없으면 null */
export async function fetchLastCollectedAt(now: Date = new Date()): Promise<string | null> {
  const client = getPublicClient();
  if (!client) return new Date(now.getTime() - 12 * 60 * 1000).toISOString();

  const { data, error } = await client.rpc("last_collected_at");
  if (error) throw new Error(`마지막 갱신 시각을 불러오지 못했어요: ${error.message}`);
  return (data as string | null) ?? null;
}
