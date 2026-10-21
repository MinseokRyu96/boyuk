import type { FeedRow } from "./types";

export const PAGE_SIZE = 20;

export type Cursor = { at: string; key: string };

/** 커서는 (최초 수집 시각, 묶음 키) 쌍이다. 주소에 넣어도 안전하도록 base64url로 감싼다. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.key]), "utf8").toString("base64url");
}

/** 형식이 잘못되었으면 null */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [at, key] = parsed;
    if (typeof at !== "string" || typeof key !== "string") return null;
    if (Number.isNaN(Date.parse(at)) || key.length === 0) return null;
    return { at, key };
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
