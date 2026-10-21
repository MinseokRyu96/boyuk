import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, paginateRows } from "./cursor";
import type { FeedRow } from "./types";

const row = (key: string, firstSeenAt: string): FeedRow => ({
  group_key: key,
  title: key,
  org_name: null,
  region: null,
  url: "https://example.com",
  deadline: null,
  is_workplace: false,
  sources: ["work24"],
  first_seen_at: firstSeenAt,
});

describe("cursor", () => {
  it("인코딩한 커서를 다시 읽을 수 있다", () => {
    const cursor = { at: "2026-10-21T00:00:00.000Z", key: "abc:1" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("잘못된 커서는 null", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from('["x","y"]').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("[1,2]").toString("base64url"))).toBeNull();
  });
});

describe("paginateRows", () => {
  it("최신순으로 limit건씩 이어서 돌려주고 마지막에는 nextCursor가 null이다", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row(`k${i}`, new Date(Date.UTC(2026, 9, 21, 12 - i)).toISOString()),
    );
    const first = paginateRows(rows, null, 3);
    expect(first.rows.map((r) => r.group_key)).toEqual(["k0", "k1", "k2"]);
    expect(first.nextCursor).not.toBeNull();

    const second = paginateRows(rows, decodeCursor(first.nextCursor!), 3);
    expect(second.rows.map((r) => r.group_key)).toEqual(["k3", "k4", "k5"]);

    const third = paginateRows(rows, decodeCursor(second.nextCursor!), 3);
    expect(third.rows.map((r) => r.group_key)).toEqual(["k6"]);
    expect(third.nextCursor).toBeNull();
  });

  it("정확히 limit건만 남았으면 빈 다음 페이지를 만들지 않는다", () => {
    const rows = [row("a", "2026-10-21T02:00:00Z"), row("b", "2026-10-21T01:00:00Z")];
    expect(paginateRows(rows, null, 2).nextCursor).toBeNull();
  });

  it("같은 시각에 저장된 공고가 페이지 경계에 걸려도 빠지지 않는다", () => {
    const same = "2026-10-21T00:00:00Z";
    const rows = ["e", "d", "c", "b", "a"].map((k) => row(k, same));
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCursor>;
    for (let guard = 0; guard < 10; guard++) {
      const page = paginateRows(rows, cursor, 2);
      seen.push(...page.rows.map((r) => r.group_key));
      if (!page.nextCursor) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual(["e", "d", "c", "b", "a"]);
  });
});
