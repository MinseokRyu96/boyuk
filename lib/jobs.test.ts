import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCursor } from "./cursor";
import type { FeedRow } from "./types";

// jobs.ts는 서버에서만 쓰도록 server-only를 가져온다. 시험에서는 막지 않는다
vi.mock("server-only", () => ({}));

/** get_feed를 흉내 내는 가짜 클라이언트. 최신순으로 정렬된 rows에서 커서 다음 limit건을 돌려준다 (SQL처럼 최대 100건) */
let rows: FeedRow[] = [];
const rpc = vi.fn(async (name: string, args: { p_cursor_at: string | null; p_cursor_key: string | null; p_limit: number }) => {
  if (name !== "get_feed") return { data: null, error: { message: `알 수 없는 함수 ${name}` } };
  const start = args.p_cursor_at
    ? rows.findIndex((r) => Date.parse(r.first_seen_at) < Date.parse(args.p_cursor_at!) || (r.first_seen_at === args.p_cursor_at && r.group_key < args.p_cursor_key!))
    : 0;
  const slice = start === -1 ? [] : rows.slice(start, start + Math.min(args.p_limit, 100));
  return { data: slice, error: null };
});
let client: unknown = { rpc };
vi.mock("./supabase", () => ({ getPublicClient: () => client }));

const { fetchFeedCounts, fetchFeedPage, fetchMapData } = await import("./jobs");

/** i번째로 최신인 공고. 구는 guOf(i)로 정한다 */
function makeRows(
  count: number,
  guOf: (i: number) => string | null,
  deadlineOf: (i: number) => string | null = () => "2099-12-31",
  sourcesOf: (i: number) => string[] = () => ["seoul_center"],
): FeedRow[] {
  return Array.from({ length: count }, (_, i) => {
    const gu = guOf(i);
    return {
      group_key: `k${String(i).padStart(4, "0")}`,
      title: `공고 ${i}`,
      org_name: `어린이집${i}`,
      region: gu === null ? null : gu === "" ? "서울" : `서울 ${gu}`,
      url: `https://example.com/${i}`,
      deadline: deadlineOf(i),
      is_workplace: false,
      sources: sourcesOf(i),
      first_seen_at: new Date(Date.UTC(2026, 9, 1) - i * 60_000).toISOString(),
    };
  });
}

const NOW = new Date("2026-10-24T00:00:00Z");

beforeEach(() => {
  rpc.mockClear();
  client = { rpc };
});

describe("fetchFeedPage — 구 필터 없음", () => {
  it("20건과 다음 커서를 돌려주고, 마지막 쪽이면 커서가 null이다", async () => {
    rows = makeRows(25, () => "마포구");
    const first = await fetchFeedPage(null, NOW);
    expect(first.cards).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();

    const second = await fetchFeedPage(decodeCursor(first.nextCursor!), NOW);
    expect(second.cards).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("fetchFeedPage — 구 필터", () => {
  it("선택한 구의 공고만 20건씩 모으고, 훑은 자리가 아니라 마지막으로 돌려준 공고에서 이어 읽는다", async () => {
    // 3건 중 1건이 마포구(대략 60건), 나머지는 은평구·구를 모르는 공고
    rows = makeRows(180, (i) => (i % 3 === 0 ? "마포구" : i % 3 === 1 ? "은평구" : ""));
    const first = await fetchFeedPage(null, NOW, { districts: ["마포구"] });

    expect(first.cards).toHaveLength(20);
    expect(first.cards.every((card) => card.region === "서울 마포구")).toBe(true);
    expect(first.cards[0].key).toBe("k0000");
    expect(first.cards[19].key).toBe("k0057");
    expect(decodeCursor(first.nextCursor!)?.key).toBe("k0057");

    const second = await fetchFeedPage(decodeCursor(first.nextCursor!), NOW, { districts: ["마포구"] });
    expect(second.cards[0].key).toBe("k0060"); // 겹치거나 빠지는 공고가 없다
    expect(second.cards).toHaveLength(20);
  });

  it("끝까지 훑었으면 다음 커서가 없고, 선택한 구가 여럿이면 합쳐서 최신순으로 돌려준다", async () => {
    rows = makeRows(40, (i) => (i % 4 === 0 ? "마포구" : i % 4 === 1 ? "서대문구" : "은평구"));
    const page = await fetchFeedPage(null, NOW, { districts: ["마포구", "서대문구"] });

    expect(page.cards.map((card) => card.key)).toEqual(
      rows.filter((r) => r.region === "서울 마포구" || r.region === "서울 서대문구").map((r) => r.group_key),
    );
    expect(page.nextCursor).toBeNull();
  });

  it("해당하는 공고가 하나도 없으면 빈 목록과 null 커서", async () => {
    rows = makeRows(30, () => "은평구");
    expect(await fetchFeedPage(null, NOW, { districts: ["마포구"] })).toEqual({ cards: [], nextCursor: null, total: 0 });
  });

  it("구를 모르는 공고(지역이 '서울'뿐이거나 없음)는 구를 고르면 걸러진다", async () => {
    rows = makeRows(10, (i) => (i < 5 ? "" : i < 8 ? null : "마포구"));
    const page = await fetchFeedPage(null, NOW, { districts: ["마포구"] });
    expect(page.cards).toHaveLength(2);
  });

  it("훑는 상한(1,000건)을 넘는 공고는 구 필터 결과에서 빠진다 (이어 읽는 커서는 없다)", async () => {
    rows = makeRows(1500, (i) => (i >= 1200 ? "마포구" : "은평구"));
    const page = await fetchFeedPage(null, NOW, { districts: ["마포구"] });

    expect(page).toMatchObject({ cards: [], nextCursor: null, total: 0 });
    expect(rpc).toHaveBeenCalledTimes(10);
  });

  it("DB 오류는 그대로 던진다", async () => {
    client = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(fetchFeedPage(null, NOW, { districts: ["마포구"] })).rejects.toThrow(/boom/);
  });
});

describe("fetchFeedPage — 마감일 정렬", () => {
  /** i번째 공고의 마감일: 2026-11-01부터 하루씩 늦어지고, 5건마다 한 건은 상시채용 */
  const deadlineOf = (i: number) => (i % 5 === 4 ? null : `2026-11-${String(1 + (i % 28)).padStart(2, "0")}`);

  it("임박순은 공고 전체를 마감일 순으로 정렬해 20건씩 돌려주고, 상시채용은 맨 뒤다", async () => {
    rows = makeRows(60, () => "마포구", deadlineOf);
    const first = await fetchFeedPage(null, NOW, {}, "soon");
    expect(first.cards).toHaveLength(20);
    expect(rpc).toHaveBeenCalledTimes(1); // 60건이라 100건씩 한 번이면 다 모인다

    // 끝까지 이어 읽으면 모든 공고가 한 번씩, 마감일 오름차순(상시채용은 맨 뒤)으로 나온다
    const seen: string[] = [];
    let page = first;
    seen.push(...page.cards.map((card) => card.key));
    while (page.nextCursor) {
      page = await fetchFeedPage(decodeCursor(page.nextCursor), NOW, {}, "soon");
      seen.push(...page.cards.map((card) => card.key));
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    const deadlines = seen.map((key) => rows.find((r) => r.group_key === key)!.deadline);
    const dated = deadlines.filter((d): d is string => d !== null);
    expect(dated).toEqual([...dated].sort());
    expect(deadlines.slice(dated.length).every((d) => d === null)).toBe(true);
  });

  it("늦은순은 마감일이 늦은 순이다", async () => {
    rows = makeRows(30, () => "마포구", deadlineOf);
    const page = await fetchFeedPage(null, NOW, {}, "late");
    const deadlines = page.cards.map((card) => rows.find((r) => r.group_key === card.key)!.deadline).filter((d): d is string => d !== null);
    expect(deadlines).toEqual([...deadlines].sort().reverse());
  });

  it("구 필터와 함께 쓰면 선택한 구의 공고만 정렬한다", async () => {
    rows = makeRows(120, (i) => (i % 2 === 0 ? "마포구" : "은평구"), deadlineOf);
    const page = await fetchFeedPage(null, NOW, { districts: ["은평구"] }, "soon");
    expect(page.cards.every((card) => card.region === "서울 은평구")).toBe(true);
    expect(page.cards).toHaveLength(20);
    expect(rpc).toHaveBeenCalledTimes(2); // 120건을 100건씩 두 번 모은다
  });

  it("한 번의 요청이 훑는 상한(1,000건)을 넘는 공고는 정렬 대상에서 빠진다", async () => {
    rows = makeRows(1200, () => "마포구", deadlineOf);
    await fetchFeedPage(null, NOW, {}, "soon");
    expect(rpc).toHaveBeenCalledTimes(10);
  });

  it("Supabase가 없을 때(샘플)도 같은 규칙으로 정렬한다", async () => {
    client = null;
    const page = await fetchFeedPage(null, NOW, {}, "soon");
    expect(page.cards).toHaveLength(20);
    // 마감일 정렬의 커서(마감일을 담은 세 값)로 이어진다. 정렬 규칙 자체는 sort.test.ts가 시험한다
    expect(decodeCursor(page.nextCursor!)?.deadline).toBeDefined();
  });
});

describe("fetchMapData", () => {
  it("위치를 찾은 공고만 points에 담고, 전체 건수에는 못 찾은 공고도 센다", async () => {
    rows = makeRows(10, () => "마포구").map((row, i) => (i < 6 ? { ...row, lat: 37.55 + i / 100, lng: 126.9 } : row));
    const data = await fetchMapData(NOW);

    expect(data.total).toBe(10);
    expect(data.points).toHaveLength(6);
    expect(data.points[0]).toMatchObject({ key: "k0000", orgName: "어린이집0", region: "서울 마포구", lat: 37.55, lng: 126.9 });
    expect(data.points[0].url).toBe("https://example.com/0"); // 카드와 같은 내용(원문 링크 등)을 담는다
  });

  it("선택한 구의 공고만 돌려주고, 100건씩 여러 번 읽어 모은다", async () => {
    rows = makeRows(250, (i) => (i % 2 === 0 ? "마포구" : "은평구")).map((row) => ({ ...row, lat: 37.5, lng: 126.9 }));
    const data = await fetchMapData(NOW, { districts: ["은평구"] });

    expect(data.total).toBe(125);
    expect(data.points).toHaveLength(125);
    expect(data.points.every((point) => point.region === "서울 은평구")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("위치가 아직 하나도 없으면(마이그레이션 전이거나 못 채움) points가 비어 있다", async () => {
    rows = makeRows(5, () => "마포구");
    expect(await fetchMapData(NOW)).toMatchObject({ total: 5, points: [] });
  });

  it("Supabase가 없을 때(샘플)는 위치가 없어서 지도가 비어 있다", async () => {
    client = null;
    const data = await fetchMapData(NOW);
    expect(data.points).toEqual([]);
    expect(data.total).toBeGreaterThan(0);
  });
});

describe("fetchFeedPage — 플랫폼(출처) 필터", () => {
  /** 4건마다 순서대로 서울센터·한솔·삼성, 그리고 서울센터와 푸르니에 함께 올라온 공고 */
  const sourcesOf = (i: number) => [["seoul_center"], ["hansol"], ["samsung"], ["seoul_center", "purunee"]][i % 4];

  it("고른 출처의 공고만 돌려주고, 조건에 맞는 전체 건수(total)를 함께 준다", async () => {
    rows = makeRows(40, () => "마포구", undefined, sourcesOf);
    const page = await fetchFeedPage(null, NOW, { sources: ["hansol"] });

    expect(page.cards).toHaveLength(10);
    expect(page.total).toBe(10);
    expect(page.nextCursor).toBeNull();
    expect(page.cards.every((card) => card.sources.some((s) => s.code === "hansol"))).toBe(true);
  });

  it("출처를 여럿 고르면 그중 하나라도 있는 공고를 합치고, 여러 출처에 걸친 공고는 한 번만 나온다", async () => {
    rows = makeRows(40, () => "마포구", undefined, sourcesOf);
    const page = await fetchFeedPage(null, NOW, { sources: ["seoul_center", "purunee"] });

    expect(page.total).toBe(20); // 서울센터만 10건 + 서울센터·푸르니 함께 10건 (중복 없이)
    expect(new Set(page.cards.map((card) => card.key)).size).toBe(page.cards.length);
    expect(page.cards).toHaveLength(20);
  });

  it("구와 출처를 함께 걸면 둘 다 만족하는 공고만, 20건씩 이어 읽는다", async () => {
    // 마포구 공고 60건 중 절반은 한솔
    rows = makeRows(120, (i) => (i % 2 === 0 ? "마포구" : "은평구"), undefined, (i) => (i % 4 === 0 ? ["hansol"] : ["seoul_center"]));
    const first = await fetchFeedPage(null, NOW, { districts: ["마포구"], sources: ["hansol"] });

    expect(first.total).toBe(30);
    expect(first.cards).toHaveLength(20);
    expect(first.cards.every((card) => card.region === "서울 마포구")).toBe(true);
    const second = await fetchFeedPage(decodeCursor(first.nextCursor!), NOW, { districts: ["마포구"], sources: ["hansol"] });
    expect(second.cards).toHaveLength(10);
    expect(second.nextCursor).toBeNull();
  });

  it("마감일 정렬과도 함께 쓴다", async () => {
    rows = makeRows(40, () => "마포구", (i) => `2026-11-${String(1 + (i % 28)).padStart(2, "0")}`, sourcesOf);
    const page = await fetchFeedPage(null, NOW, { sources: ["samsung"] }, "soon");

    expect(page.total).toBe(10);
    const deadlines = page.cards.map((card) => rows.find((r) => r.group_key === card.key)!.deadline!);
    expect(deadlines).toEqual([...deadlines].sort());
  });

  it("해당 출처의 공고가 없으면 빈 목록과 total 0", async () => {
    rows = makeRows(10, () => "마포구");
    expect(await fetchFeedPage(null, NOW, { sources: ["samsung"] })).toEqual({ cards: [], nextCursor: null, total: 0 });
  });

  it("필터도 정렬도 없는 기본 화면은 DB를 한 번만 읽고 total을 계산하지 않는다", async () => {
    rows = makeRows(50, () => "마포구");
    const page = await fetchFeedPage(null, NOW);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(page.total).toBeUndefined();
  });

  it("Supabase가 없을 때(샘플)도 출처 필터가 걸린다", async () => {
    client = null;
    const page = await fetchFeedPage(null, NOW, { sources: ["samsung"] });
    expect(page.total).toBeGreaterThan(0);
    expect(page.cards.every((card) => card.sources.some((s) => s.code === "samsung"))).toBe(true);
  });
});

describe("fetchFeedCounts", () => {
  it("구별 건수와 전체 건수를 센다 (100건씩 여러 번 훑는다)", async () => {
    rows = makeRows(250, (i) => (i % 5 === 0 ? "마포구" : i % 5 === 1 ? "은평구" : i % 5 === 2 ? "" : "중구"));
    const counts = await fetchFeedCounts(NOW);

    expect(counts).toEqual({ total: 250, byDistrict: { 마포구: 50, 은평구: 50, 중구: 100 }, bySource: { seoul_center: 250 } });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("fetchFeedCounts — 출처별", () => {
  it("출처마다 센다: 여러 출처에 올라온 공고는 출처마다 한 건씩 세서 합이 전체보다 클 수 있다", async () => {
    rows = makeRows(8, () => "마포구", undefined, (i) => (i % 4 === 3 ? ["seoul_center", "purunee"] : i % 4 === 2 ? ["samsung"] : ["seoul_center"]));
    const counts = await fetchFeedCounts(NOW);

    expect(counts.total).toBe(8);
    expect(counts.bySource).toEqual({ seoul_center: 6, purunee: 2, samsung: 2 });
  });

  it("알 수 없는 출처 코드는 세지 않는다", async () => {
    rows = makeRows(2, () => "마포구", undefined, () => ["naver"]);
    expect((await fetchFeedCounts(NOW)).bySource).toEqual({});
  });
});

describe("Supabase가 없을 때(샘플 데이터)", () => {
  it("구 필터도 샘플 공고에 같은 규칙으로 걸린다", async () => {
    client = null;
    const all = await fetchFeedPage(null, NOW);
    const filtered = await fetchFeedPage(null, NOW, { districts: ["강서구"] });

    expect(all.cards.length).toBe(20);
    expect(filtered.cards.length).toBeGreaterThan(0);
    expect(filtered.cards.every((card) => card.region === "서울 강서구")).toBe(true);
  });
});
