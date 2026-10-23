import { describe, expect, it } from "vitest";
import { decodeCursor } from "./cursor";
import { compareByDeadline, paginateByDeadline, parseSort } from "./sort";
import type { FeedRow } from "./types";

const row = (key: string, deadline: string | null, minutesAgo = 0): FeedRow => ({
  group_key: key,
  title: key,
  org_name: null,
  region: "서울 마포구",
  url: "https://example.com",
  deadline,
  is_workplace: false,
  sources: ["seoul_center"],
  first_seen_at: new Date(Date.UTC(2026, 9, 24, 0, 0) - minutesAgo * 60_000).toISOString(),
});

const keys = (rows: FeedRow[]) => rows.map((r) => r.group_key);

describe("parseSort", () => {
  it("없으면 최신순, 알려진 값은 그대로, 모르는 값은 null", () => {
    expect(parseSort(null)).toBe("new");
    expect(parseSort("soon")).toBe("soon");
    expect(parseSort("late")).toBe("late");
    expect(parseSort("new")).toBe("new");
    expect(parseSort("")).toBeNull();
    expect(parseSort("desc")).toBeNull();
  });
});

describe("compareByDeadline", () => {
  const rows = [row("c", "2026-11-10"), row("a", "2026-10-25"), row("open", null), row("b", "2026-11-01")];

  it("임박순은 마감일이 이른 순이고 상시채용은 맨 뒤", () => {
    expect(keys([...rows].sort(compareByDeadline("soon")))).toEqual(["a", "b", "c", "open"]);
  });

  it("늦은순은 마감일이 늦은 순이고 상시채용은 여전히 맨 뒤", () => {
    expect(keys([...rows].sort(compareByDeadline("late")))).toEqual(["c", "b", "a", "open"]);
  });

  it("같은 마감일은 최신순, 그것도 같으면 키가 큰 것부터", () => {
    const tied = [row("old", "2026-11-01", 60), row("new", "2026-11-01", 5), row("z", "2026-11-01", 5), row("openOld", null, 90), row("openNew", null, 1)];
    expect(keys([...tied].sort(compareByDeadline("soon")))).toEqual(["z", "new", "old", "openNew", "openOld"]);
  });
});

describe("paginateByDeadline", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`k${i}`, `2026-11-0${i + 1}`, i));

  it("정렬한 순서로 limit건씩 이어서 돌려주고 마지막에는 nextCursor가 null이다", () => {
    const first = paginateByDeadline(rows, null, "soon", 3);
    expect(keys(first.rows)).toEqual(["k0", "k1", "k2"]);

    const second = paginateByDeadline(rows, decodeCursor(first.nextCursor!), "soon", 3);
    expect(keys(second.rows)).toEqual(["k3", "k4", "k5"]);

    const third = paginateByDeadline(rows, decodeCursor(second.nextCursor!), "soon", 3);
    expect(keys(third.rows)).toEqual(["k6"]);
    expect(third.nextCursor).toBeNull();
  });

  it("늦은순도 같은 방식으로 이어진다", () => {
    const first = paginateByDeadline(rows, null, "late", 3);
    expect(keys(first.rows)).toEqual(["k6", "k5", "k4"]);
    expect(keys(paginateByDeadline(rows, decodeCursor(first.nextCursor!), "late", 3).rows)).toEqual(["k3", "k2", "k1"]);
  });

  it("정확히 limit건만 남았으면 빈 다음 페이지를 만들지 않는다", () => {
    expect(paginateByDeadline(rows.slice(0, 3), null, "soon", 3).nextCursor).toBeNull();
  });

  it("마감일이 같은 공고가 페이지 경계에 걸리거나 상시채용이 섞여도 빠지거나 겹치지 않는다", () => {
    const mixed = [row("a", "2026-11-01", 1), row("b", "2026-11-01", 2), row("c", "2026-11-01", 3), row("d", null, 4), row("e", null, 5), row("f", "2026-10-30", 6)];
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCursor>;
    for (let guard = 0; guard < 10; guard++) {
      const page = paginateByDeadline(mixed, cursor, "soon", 2);
      seen.push(...keys(page.rows));
      if (!page.nextCursor) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual(["f", "a", "b", "c", "d", "e"]);
  });

  it("페이지 사이에 마지막으로 본 공고가 사라져도 그 자리 다음부터 이어 읽는다", () => {
    const first = paginateByDeadline(rows, null, "soon", 3);
    const without = rows.filter((r) => r.group_key !== "k2");
    expect(keys(paginateByDeadline(without, decodeCursor(first.nextCursor!), "soon", 3).rows)).toEqual(["k3", "k4", "k5"]);
  });

  it("마지막 공고 뒤의 커서이면 빈 목록", () => {
    expect(paginateByDeadline(rows, { at: rows[6].first_seen_at, key: "k6", deadline: "2026-11-07" }, "soon", 3)).toEqual({ rows: [], nextCursor: null });
  });

  it("최신순 커서(마감일 없음)가 오면 처음부터 읽는다", () => {
    expect(keys(paginateByDeadline(rows, { at: rows[3].first_seen_at, key: "k3" }, "soon", 2).rows)).toEqual(["k0", "k1"]);
  });
});
