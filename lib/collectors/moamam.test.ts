import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { HttpError, type HttpClient, type HttpResponse } from "./http";
import { MOAMAM_BOARDS, MoamamError, buildMoamamUrl, createMoamamCollector, parseMoamamList } from "./moamam";
import { CrawlNotAllowedError } from "./robots";

const STAFF_HTML = readFileSync(join(__dirname, "__fixtures__/moamam-staff-list.html"), "utf8");
const REGULAR_HTML = readFileSync(join(__dirname, "__fixtures__/moamam-regular-list.html"), "utf8");
const [STAFF, REGULAR] = MOAMAM_BOARDS;

describe("parseMoamamList — 교직원채용 시험용 축약 목록", () => {
  const page = parseMoamamList(STAFF_HTML, STAFF);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("마감된 줄은 읽지 않고, 줄 수에는 센다", () => {
    expect(page.itemCount).toBe(6);
    expect(page.jobs.map((job) => job.sourceId)).toEqual(["1-9100005", "1-9100004", "1-9100003", "1-9100002", "1-9100001"]);
  });

  it("필드를 공통 형식으로 옮기고, 원문 링크는 사이트가 붙인 검색 파라미터 없이 다시 만든다", () => {
    expect(byId("1-9100005")).toEqual({
      sourceId: "1-9100005",
      title: "[서울] 가나다병원 어린이집 영아반 담임교사 채용공고",
      orgName: "가나다병원어린이집",
      region: "서울",
      deadline: "2026-11-05",
      url: "https://recruit.moamom.com/recruitment/staff-view.php?type=1&mode=view&idx=9100005",
      rawText: undefined,
      careerHint: "new",
    });
  });

  it("제목 앞 대괄호의 시·도를 지역으로 쓰고, 이름의 앞뒤 공백을 지운다", () => {
    expect(byId("1-9100004")?.region).toBe("충북");
    expect(byId("1-9100004")?.title).toBe("[충북] [청주] 라마바어린이집 담임교사 모집");
    expect(byId("1-9100004")?.orgName).toBe("라마바어린이집, 사아자어린이집");
  });

  it("경력 구분(신입·경력·무관)을 careerHint로 옮긴다", () => {
    expect(byId("1-9100005")?.careerHint).toBe("new");
    expect(byId("1-9100004")?.careerHint).toBe("any");
    expect(byId("1-9100002")?.careerHint).toBe("experienced");
  });

  it("마감일은 접수 기간의 끝 날짜이고, 날짜가 아니면(채용시까지) 마감일 없음", () => {
    expect(byId("1-9100003")?.deadline).toBe("2026-10-26");
    expect(byId("1-9100001")?.deadline).toBeUndefined();
  });

  it("신입·담임 판별: 담임은 저장하고 보조·연장 겸직과 경력 공고는 거른다", () => {
    expect(page.jobs.filter(isTarget).map((job) => job.sourceId)).toEqual(["1-9100005", "1-9100004", "1-9100001"]);
  });
});

describe("parseMoamamList — 정기채용", () => {
  const page = parseMoamamList(REGULAR_HTML, REGULAR);

  it("정기채용 주소(type=2)로 링크를 만들고, 직무는 '교사 정기채용'으로 판별한다", () => {
    expect(page.jobs.map((job) => job.url)).toEqual([
      "https://recruit.moamom.com/recruitment/regular-view.php?type=2&mode=view&idx=9200002",
      "https://recruit.moamom.com/recruitment/regular-view.php?type=2&mode=view&idx=9200001",
    ]);
    expect(page.jobs[0]).toMatchObject({ sourceId: "2-9200002", region: "세종", rawText: "교사 정기채용", careerHint: "any" });
    // 제목에 직무가 없어도 교사 정기채용이라 저장 대상이다
    expect(page.jobs.every(isTarget)).toBe(true);
  });
});

describe("parseMoamamList — 예외", () => {
  it("목록 영역이 없으면 사이트 구조가 바뀐 것으로 보고 오류를 던진다", () => {
    expect(() => parseMoamamList("<html><body>점검 중</body></html>", STAFF)).toThrow(MoamamError);
  });

  it("줄이 하나도 없는 목록은 0건으로 읽는다", () => {
    expect(parseMoamamList('<div class="list"><ul></ul></div>', STAFF)).toEqual({ itemCount: 0, jobs: [] });
  });

  it("다른 게시판의 주소이거나 idx가 숫자가 아닌 줄은 읽지 않는다", () => {
    const html = STAFF_HTML.replace("staff-view.php?type=1&mode=view&idx=9100005", "regular-view.php?type=1&mode=view&idx=9100005").replace(
      "idx=9100004",
      "idx=x%22%3E",
    );
    const ids = parseMoamamList(html, STAFF).jobs.map((job) => job.sourceId);
    expect(ids).not.toContain("1-9100005");
    expect(ids).not.toContain("1-9100004");
  });
});

describe("buildMoamamUrl", () => {
  it("게시판 주소에 offset을 붙인다", () => {
    expect(buildMoamamUrl(STAFF, 20)).toBe("https://recruit.moamom.com/recruitment/staff-list.php?offset=20");
    expect(buildMoamamUrl(REGULAR, 0)).toBe("https://recruit.moamom.com/recruitment/regular-list.php?offset=0");
  });
});

/** 접수 중(또는 마감) 줄 n개짜리 목록 HTML. idx는 base부터 이어진다 */
function listHtml(board: (typeof MOAMAM_BOARDS)[number], base: number, rows: number, closed = false): string {
  const items = Array.from({ length: rows }, (_, i) => {
    const idx = base + i;
    return closed
      ? `<li class='deadline'><a href ="#"><div class="tit">[서울] 마감 담임교사 ${idx}</div><div class="detail"><span>시험${idx}어린이집</span><span>무관</span><span>계약</span></div><div class="period">2026-01-01~2026-01-10</div></a></li>`
      : `<li><a href ="${board.viewPath}?type=${board.type}&mode=view&idx=${idx}&sk=&sw=&offset=&category="><div class="tit">[서울] 담임교사 ${idx}</div><div class="detail"><span>시험${idx}어린이집</span><span>무관</span><span>계약</span></div><div class="period">2026-10-01~2099-12-31</div></a></li>`;
  }).join("");
  return `<div class="list"><ul>${items}</ul></div>`;
}

function ok(body: string): HttpResponse {
  return { status: 200, body, headers: new Headers(), attempts: 1 };
}

type Route = (url: URL) => HttpResponse | Error;

function fakeHttp(route: Route) {
  const get = vi.fn(async (url: string) => {
    const reply = route(new URL(url));
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { http: { get } as HttpClient, get };
}

const boardOf = (url: URL) => (url.pathname.includes("staff") ? STAFF : REGULAR);
const offsetOf = (url: URL) => Number(url.searchParams.get("offset"));
const listCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => url).filter((url) => !url.endsWith("/robots.txt"));
const noRobots = (url: URL) => new HttpError("HTTP 404", 404, url.toString(), 1);

describe("createMoamamCollector", () => {
  it("robots.txt를 먼저 확인하고, 두 게시판을 끝까지 읽으면 complete: true", async () => {
    const route: Route = (url) => {
      if (url.pathname === "/robots.txt") return ok("User-agent: * \nAllow: /\n");
      const board = boardOf(url);
      const offset = offsetOf(url);
      // 교직원채용 15건(10 + 5), 정기채용 4건
      const total = board.key === "staff" ? 15 : 4;
      return ok(listHtml(board, 1000 * board.type + offset, Math.max(0, Math.min(10, total - offset))));
    };
    const { http, get } = fakeHttp(route);
    const result = await createMoamamCollector({ http }).fetchJobs();

    expect(get.mock.calls[0][0]).toBe("https://recruit.moamom.com/robots.txt");
    expect(listCalls(get)).toHaveLength(3); // 교직원채용 2쪽 + 정기채용 1쪽
    expect(result.complete).toBe(true);
    expect(result.jobs).toHaveLength(19);
    expect(new Set(result.jobs.map((job) => job.sourceId)).size).toBe(19);
  });

  it("한 쪽이 전부 마감이면 더 읽지 않고 멈추며, 목록 일부만 읽은 것이라 complete: false", async () => {
    const route: Route = (url) => {
      if (url.pathname === "/robots.txt") return noRobots(url);
      const board = boardOf(url);
      const offset = offsetOf(url);
      // 첫 쪽은 접수 중, 둘째 쪽부터는 전부 마감 (한 쪽을 가득 채워 목록이 끝나지 않은 것으로 보이게 한다)
      return ok(listHtml(board, 5000 + offset, 10, offset >= 10));
    };
    const { http, get } = fakeHttp(route);
    const result = await createMoamamCollector({ http }).fetchJobs();

    expect(listCalls(get).map((url) => new URL(url).pathname + new URL(url).search)).toEqual([
      "/recruitment/staff-list.php?offset=0",
      "/recruitment/staff-list.php?offset=10",
      "/recruitment/regular-list.php?offset=0",
      "/recruitment/regular-list.php?offset=10",
    ]);
    expect(result.jobs).toHaveLength(20);
    expect(result.complete).toBe(false);
  });

  it("쪽 상한에 걸려도 complete: false", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? noRobots(url) : ok(listHtml(boardOf(url), 100 * offsetOf(url) + boardOf(url).type * 100000, 10)));
    const { http, get } = fakeHttp(route);
    const result = await createMoamamCollector({ http, maxPages: 2 }).fetchJobs();

    expect(listCalls(get)).toHaveLength(4);
    expect(result.complete).toBe(false);
  });

  it("robots.txt가 막으면 목록을 한 번도 요청하지 않고 CrawlNotAllowedError", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? ok("User-agent: *\nDisallow: /\n") : ok(listHtml(STAFF, 1, 10)));
    const { http, get } = fakeHttp(route);

    await expect(createMoamamCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(CrawlNotAllowedError);
    expect(listCalls(get)).toHaveLength(0);
  });

  it("구조가 바뀐 응답은 수집 실패로 드러난다", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? noRobots(url) : ok("<html>개편</html>"));
    const { http } = fakeHttp(route);
    await expect(createMoamamCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(MoamamError);
  });
});
