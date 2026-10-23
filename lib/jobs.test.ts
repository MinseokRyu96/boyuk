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

const { fetchDistrictCounts, fetchFeedPage } = await import("./jobs");

/** i번째로 최신인 공고. 구는 guOf(i)로 정한다 */
function makeRows(count: number, guOf: (i: number) => string | null): FeedRow[] {
  return Array.from({ length: count }, (_, i) => {
    const gu = guOf(i);
    return {
      group_key: `k${String(i).padStart(4, "0")}`,
      title: `공고 ${i}`,
      org_name: `어린이집${i}`,
      region: gu === null ? null : gu === "" ? "서울" : `서울 ${gu}`,
      url: `https://example.com/${i}`,
      deadline: "2099-12-31",
      is_workplace: false,
      sources: ["seoul_center"],
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
    const first = await fetchFeedPage(null, NOW, ["마포구"]);

    expect(first.cards).toHaveLength(20);
    expect(first.cards.every((card) => card.region === "서울 마포구")).toBe(true);
    expect(first.cards[0].key).toBe("k0000");
    expect(first.cards[19].key).toBe("k0057");
    expect(decodeCursor(first.nextCursor!)?.key).toBe("k0057");

    const second = await fetchFeedPage(decodeCursor(first.nextCursor!), NOW, ["마포구"]);
    expect(second.cards[0].key).toBe("k0060"); // 겹치거나 빠지는 공고가 없다
    expect(second.cards).toHaveLength(20);
  });

  it("끝까지 훑었으면 다음 커서가 없고, 선택한 구가 여럿이면 합쳐서 최신순으로 돌려준다", async () => {
    rows = makeRows(40, (i) => (i % 4 === 0 ? "마포구" : i % 4 === 1 ? "서대문구" : "은평구"));
    const page = await fetchFeedPage(null, NOW, ["마포구", "서대문구"]);

    expect(page.cards.map((card) => card.key)).toEqual(
      rows.filter((r) => r.region === "서울 마포구" || r.region === "서울 서대문구").map((r) => r.group_key),
    );
    expect(page.nextCursor).toBeNull();
  });

  it("해당하는 공고가 하나도 없으면 빈 목록과 null 커서", async () => {
    rows = makeRows(30, () => "은평구");
    expect(await fetchFeedPage(null, NOW, ["마포구"])).toEqual({ cards: [], nextCursor: null });
  });

  it("구를 모르는 공고(지역이 '서울'뿐이거나 없음)는 구를 고르면 걸러진다", async () => {
    rows = makeRows(10, (i) => (i < 5 ? "" : i < 8 ? null : "마포구"));
    const page = await fetchFeedPage(null, NOW, ["마포구"]);
    expect(page.cards).toHaveLength(2);
  });

  it("훑는 상한(1,000건)에 걸리면 이번 응답이 비어 있어도 훑은 자리에서 이어 읽을 커서를 준다", async () => {
    rows = makeRows(1500, (i) => (i >= 1200 ? "마포구" : "은평구"));
    const first = await fetchFeedPage(null, NOW, ["마포구"]);

    expect(first.cards).toHaveLength(0);
    expect(rpc).toHaveBeenCalledTimes(10);
    expect(decodeCursor(first.nextCursor!)?.key).toBe("k0999");

    const next = await fetchFeedPage(decodeCursor(first.nextCursor!), NOW, ["마포구"]);
    expect(next.cards).toHaveLength(20);
    expect(next.cards[0].key).toBe("k1200");
  });

  it("DB 오류는 그대로 던진다", async () => {
    client = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(fetchFeedPage(null, NOW, ["마포구"])).rejects.toThrow(/boom/);
  });
});

describe("fetchDistrictCounts", () => {
  it("구별 건수와 전체 건수를 센다 (100건씩 여러 번 훑는다)", async () => {
    rows = makeRows(250, (i) => (i % 5 === 0 ? "마포구" : i % 5 === 1 ? "은평구" : i % 5 === 2 ? "" : "중구"));
    const counts = await fetchDistrictCounts(NOW);

    expect(counts).toEqual({ total: 250, byDistrict: { 마포구: 50, 은평구: 50, 중구: 100 } });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("Supabase가 없을 때(샘플 데이터)", () => {
  it("구 필터도 샘플 공고에 같은 규칙으로 걸린다", async () => {
    client = null;
    const all = await fetchFeedPage(null, NOW);
    const filtered = await fetchFeedPage(null, NOW, ["강서구"]);

    expect(all.cards.length).toBe(20);
    expect(filtered.cards.length).toBeGreaterThan(0);
    expect(filtered.cards.every((card) => card.region === "서울 강서구")).toBe(true);
  });
});
