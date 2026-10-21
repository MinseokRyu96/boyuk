import "server-only";
import { PAGE_SIZE, encodeCursor, paginateRows, type Cursor } from "./cursor";
import { toCard } from "./feed";
import { buildSampleRows } from "./sample-jobs";
import { getPublicClient } from "./supabase";
import type { FeedPage, FeedRow } from "./types";

/** Supabase가 연결되어 있지 않으면 샘플 데이터로 동작한다 */
export function isSampleMode(): boolean {
  return getPublicClient() === null;
}

/** 커서 다음 공고 PAGE_SIZE건. 다음 페이지가 있는지 알기 위해 한 건 더 조회한다 */
export async function fetchFeedPage(cursor: Cursor | null, now: Date = new Date()): Promise<FeedPage> {
  const client = getPublicClient();

  if (!client) {
    const page = paginateRows(buildSampleRows(now), cursor, PAGE_SIZE);
    return { cards: page.rows.map((row) => toCard(row, now)), nextCursor: page.nextCursor };
  }

  const { data, error } = await client.rpc("get_feed", {
    p_cursor_at: cursor?.at ?? null,
    p_cursor_key: cursor?.key ?? null,
    p_limit: PAGE_SIZE + 1,
  });
  if (error) throw new Error(`공고를 불러오지 못했어요: ${error.message}`);

  const rows = (data ?? []) as FeedRow[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    cards: page.map((row) => toCard(row, now)),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor({ at: last.first_seen_at, key: last.group_key }) : null,
  };
}

/** 성공한 가장 최근 수집 시각(ISO). 아직 수집한 적이 없으면 null */
export async function fetchLastCollectedAt(now: Date = new Date()): Promise<string | null> {
  const client = getPublicClient();
  if (!client) return new Date(now.getTime() - 12 * 60 * 1000).toISOString();

  const { data, error } = await client.rpc("last_collected_at");
  if (error) throw new Error(`마지막 갱신 시각을 불러오지 못했어요: ${error.message}`);
  return (data as string | null) ?? null;
}
