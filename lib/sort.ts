import { PAGE_SIZE, encodeCursor, type Cursor } from "./cursor";
import type { FeedRow } from "./types";

/*
 * 공고 정렬. 화면(클라이언트)과 서버가 함께 쓰므로 server-only가 아닌 파일에 둔다.
 *  - new: 등록 최신순. 기본값이고 DB의 get_feed가 이 순서로 돌려준다
 *  - soon: 마감 임박순. 마감일이 이른 공고부터
 *  - late: 마감 늦은순. 마감일이 늦은 공고부터
 * 마감일이 없는 상시채용은 D-day를 비교할 수 없어서 두 마감일 정렬 모두 맨 뒤에 둔다.
 * 같은 마감일끼리는 최신순으로 정렬한다.
 */
export const FEED_SORTS = ["new", "soon", "late"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

export const SORT_LABELS: Record<FeedSort, string> = { new: "최신순", soon: "마감 임박순", late: "마감 늦은순" };

export function isFeedSort(value: string): value is FeedSort {
  return (FEED_SORTS as readonly string[]).includes(value);
}

/** 주소의 sort 파라미터. 없으면 최신순, 알 수 없는 값이면 null */
export function parseSort(value: string | null): FeedSort | null {
  if (value === null) return "new";
  return isFeedSort(value) ? value : null;
}

type SortableRow = Pick<FeedRow, "group_key" | "first_seen_at" | "deadline">;

/** 마감일 정렬의 비교 함수. 서로 다른 공고는 group_key까지 비교해서 항상 순서가 정해진다 */
export function compareByDeadline(sort: "soon" | "late") {
  return (a: SortableRow, b: SortableRow): number => {
    if (a.deadline !== b.deadline) {
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      const earlier = a.deadline < b.deadline ? -1 : 1;
      return sort === "soon" ? earlier : -earlier;
    }
    const newer = Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at);
    if (newer !== 0) return newer;
    return a.group_key < b.group_key ? 1 : a.group_key > b.group_key ? -1 : 0;
  };
}

/**
 * 묶인 행 전체를 마감일 순으로 정렬해 커서 다음 limit건을 잘라낸다. 커서는 마지막으로 돌려준 공고의 위치(마감일, 수집 시각, 키)라서
 * 페이지 사이에 공고가 늘거나 줄어도 겹치거나 빠지지 않는다. 커서에 마감일이 없으면(최신순 커서) 처음부터 읽는다.
 */
export function paginateByDeadline(
  rows: FeedRow[],
  cursor: Cursor | null,
  sort: "soon" | "late",
  limit: number = PAGE_SIZE,
): { rows: FeedRow[]; nextCursor: string | null } {
  const compare = compareByDeadline(sort);
  const sorted = [...rows].sort(compare);
  const after = cursor && cursor.deadline !== undefined ? { group_key: cursor.key, first_seen_at: cursor.at, deadline: cursor.deadline } : null;
  const start = after ? sorted.findIndex((row) => compare(row, after) > 0) : 0;
  if (start === -1) return { rows: [], nextCursor: null };

  const page = sorted.slice(start, start + limit);
  const last = page[page.length - 1];
  const hasMore = sorted.length > start + limit;
  return {
    rows: page,
    nextCursor: hasMore && last ? encodeCursor({ at: last.first_seen_at, key: last.group_key, deadline: last.deadline }) : null,
  };
}
