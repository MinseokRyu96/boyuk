import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE, encodeCursor, paginateRows, type Cursor } from "./cursor";
import { districtOf, matchesDistricts, type DistrictCounts } from "./districts";
import { toCard } from "./feed";
import { buildSampleRows } from "./sample-jobs";
import { paginateByDeadline, type FeedSort } from "./sort";
import { getPublicClient } from "./supabase";
import type { FeedPage, FeedRow } from "./types";

/** Supabase가 연결되어 있지 않으면 샘플 데이터로 동작한다 */
export function isSampleMode(): boolean {
  return getPublicClient() === null;
}

/** get_feed가 한 번에 돌려주는 최대 건수 (SQL이 100으로 자른다) */
const SCAN_SIZE = 100;
/** 구 필터로 훑는 최대 횟수. 지금 공고 수(수백 건)보다 훨씬 크고, 잘못된 조건이 DB를 오래 붙잡지 못하게 한다 */
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

/** 선택한 구의 공고 전부를 최신순으로 모은다. 훑는 상한(MAX_SCAN_BATCHES × 100건)을 넘는 공고는 빠진다 */
async function scanAll(client: SupabaseClient, districts: readonly string[]): Promise<FeedRow[]> {
  const found: FeedRow[] = [];
  let cursor: Cursor | null = null;
  for (let batch = 0; batch < MAX_SCAN_BATCHES; batch++) {
    const rows = await rpcFeed(client, cursor, SCAN_SIZE);
    for (const row of rows) if (matchesDistricts(row.region, districts)) found.push(row);
    if (rows.length < SCAN_SIZE) break;
    cursor = cursorOf(rows[rows.length - 1]);
  }
  return found;
}

/**
 * 구 필터가 걸린 다음 페이지. get_feed는 지역 조건을 받지 못해서(SQL을 바꾸면 마이그레이션을 따로 적용해야 한다),
 * 최신순으로 100건씩 훑으며 선택한 구의 공고만 모은다. PAGE_SIZE + 1건이 모이면 멈추고, 끝까지 훑었으면 다음 페이지가 없다.
 * 훑는 상한에 걸리면 마지막으로 훑은 자리부터 이어 읽도록 커서를 돌려준다 (이때 이번 응답이 비어 있을 수 있다).
 */
async function fetchFilteredPage(
  client: SupabaseClient,
  cursor: Cursor | null,
  now: Date,
  districts: readonly string[],
): Promise<FeedPage> {
  const matched: FeedRow[] = [];
  let scanFrom = cursor;
  let lastScanned: FeedRow | undefined;
  let exhausted = false;

  for (let batch = 0; batch < MAX_SCAN_BATCHES && matched.length <= PAGE_SIZE; batch++) {
    const rows = await rpcFeed(client, scanFrom, SCAN_SIZE);
    for (const row of rows) {
      lastScanned = row;
      if (matchesDistricts(row.region, districts)) matched.push(row);
    }
    if (rows.length < SCAN_SIZE) {
      exhausted = true;
      break;
    }
    scanFrom = cursorOf(rows[rows.length - 1]);
  }

  const page = matched.slice(0, PAGE_SIZE);
  let nextCursor: string | null = null;
  if (matched.length > PAGE_SIZE) nextCursor = encodeCursor(cursorOf(page[PAGE_SIZE - 1]));
  else if (!exhausted && lastScanned) nextCursor = encodeCursor(cursorOf(lastScanned));
  return { cards: page.map((row) => toCard(row, now)), nextCursor };
}

/**
 * 커서 다음 공고 PAGE_SIZE건. 다음 페이지가 있는지 알기 위해 한 건 더 조회한다.
 * districts(서울의 구)를 주면 그 구의 공고만 돌려준다. 비우면 서울 전체다.
 * sort가 soon·late(마감 임박순·늦은순)이면 get_feed가 이 순서를 지원하지 않아서(SQL을 바꾸면 마이그레이션을 따로 적용해야 한다)
 * 공고 전체를 모아 서버에서 정렬한 뒤 잘라 준다. 이때 커서는 마감일을 담은 sort 전용이라 최신순 커서와 섞어 쓰지 않는다.
 */
export async function fetchFeedPage(
  cursor: Cursor | null,
  now: Date = new Date(),
  districts: readonly string[] = [],
  sort: FeedSort = "new",
): Promise<FeedPage> {
  const client = getPublicClient();

  if (!client) {
    const rows = buildSampleRows(now).filter((row) => matchesDistricts(row.region, districts));
    const page = sort === "new" ? paginateRows(rows, cursor, PAGE_SIZE) : paginateByDeadline(rows, cursor, sort, PAGE_SIZE);
    return { cards: page.rows.map((row) => toCard(row, now)), nextCursor: page.nextCursor };
  }

  if (sort !== "new") {
    const page = paginateByDeadline(await scanAll(client, districts), cursor, sort, PAGE_SIZE);
    return { cards: page.rows.map((row) => toCard(row, now)), nextCursor: page.nextCursor };
  }

  if (districts.length > 0) return fetchFilteredPage(client, cursor, now, districts);

  const rows = await rpcFeed(client, cursor, PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    cards: page.map((row) => toCard(row, now)),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(cursorOf(last)) : null,
  };
}

/** 지금 보이는 공고의 구별 건수. 구 필터 칩에 숫자를 붙이는 데 쓴다 (같은 공고는 이미 한 건으로 묶여 있다) */
export async function fetchDistrictCounts(now: Date = new Date()): Promise<DistrictCounts> {
  const tally = (rows: FeedRow[], counts: DistrictCounts) => {
    for (const row of rows) {
      counts.total++;
      const gu = districtOf(row.region);
      if (gu) counts.byDistrict[gu] = (counts.byDistrict[gu] ?? 0) + 1;
    }
  };
  const counts: DistrictCounts = { total: 0, byDistrict: {} };

  const client = getPublicClient();
  if (!client) {
    tally(buildSampleRows(now), counts);
    return counts;
  }

  let cursor: Cursor | null = null;
  for (let batch = 0; batch < MAX_SCAN_BATCHES; batch++) {
    const rows = await rpcFeed(client, cursor, SCAN_SIZE);
    tally(rows, counts);
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
