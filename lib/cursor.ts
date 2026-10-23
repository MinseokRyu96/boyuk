import type { FeedRow } from "./types";

export const PAGE_SIZE = 20;

/**
 * 최신순 커서는 (최초 수집 시각 at, 묶음 키 key) 쌍이다.
 * 마감일 정렬(임박순·늦은순)의 커서는 마감일 deadline(상시채용이면 null)을 앞에 더한 세 값이다.
 * deadline이 undefined이면 최신순 커서다.
 */
export type Cursor = { at: string; key: string; deadline?: string | null };

/** 주소에 넣어도 안전하도록 base64url로 감싼다. */
export function encodeCursor(cursor: Cursor): string {
  const values = cursor.deadline === undefined ? [cursor.at, cursor.key] : [cursor.deadline, cursor.at, cursor.key];
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/** 형식이 잘못되었으면 null */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || (parsed.length !== 2 && parsed.length !== 3)) return null;
    const hasDeadline = parsed.length === 3;
    const [deadline, at, key] = hasDeadline ? parsed : [undefined, ...parsed];
    if (typeof at !== "string" || typeof key !== "string") return null;
    if (Number.isNaN(Date.parse(at)) || key.length === 0) return null;
    if (!hasDeadline) return { at, key };
    // 마감일은 'YYYY-MM-DD'이거나 상시채용을 뜻하는 null이다
    if (deadline !== null && (typeof deadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(deadline))) return null;
    return { at, key, deadline };
  } catch {
    return null;
  }
}

/**
 * 이미 묶여 있는 행 목록에서 커서 다음 limit건을 잘라낸다.
 * DB의 get_feed와 같은 정렬·비교 규칙이며, DB가 없을 때의 샘플 데이터에 쓴다.
 * 남은 공고가 없으면 nextCursor가 null이라 마지막 응답 뒤에 빈 요청이 가지 않는다.
 */
export function paginateRows(
  rows: FeedRow[],
  cursor: Cursor | null,
  limit: number = PAGE_SIZE,
): { rows: FeedRow[]; nextCursor: string | null } {
  const sorted = [...rows].sort(
    (a, b) =>
      Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at) ||
      (a.group_key < b.group_key ? 1 : a.group_key > b.group_key ? -1 : 0),
  );
  const start = cursor
    ? sorted.findIndex(
        (r) =>
          Date.parse(r.first_seen_at) < Date.parse(cursor.at) ||
          (Date.parse(r.first_seen_at) === Date.parse(cursor.at) && r.group_key < cursor.key),
      )
    : 0;
  if (start === -1) return { rows: [], nextCursor: null };
  const page = sorted.slice(start, start + limit);
  const hasMore = sorted.length > start + limit;
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: hasMore && last ? encodeCursor({ at: last.first_seen_at, key: last.group_key }) : null,
  };
}
