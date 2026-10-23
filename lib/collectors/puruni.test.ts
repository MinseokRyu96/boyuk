import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { HttpError, type HttpClient, type HttpResponse } from "./http";
import { PuruniError, buildPuruniUrl, createPuruniCollector, parsePuruniList } from "./puruni";
import { CrawlNotAllowedError } from "./robots";

const LIST_HTML = readFileSync(join(__dirname, "__fixtures__/puruni-list.html"), "utf8");

describe("parsePuruniList — 시험용 축약 목록", () => {
  const page = parsePuruniList(LIST_HTML);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("공고 줄을 모두 읽는다", () => {
    expect(page.itemCount).toBe(4);
    expect(page.jobs.map((job) => job.sourceId)).toEqual(["9400004", "9400003", "9400002", "9400001"]);
  });

  it("필드를 공통 형식으로 옮기고, 원문 링크는 상세를 GET으로 여는 주소로 만든다", () => {
    expect(byId("9400002")).toEqual({
      sourceId: "9400002",
      title: "[경기수원] 사아자어린이집 담임교사 채용",
      orgName: "사아자어린이집",
      region: "경기",
      deadline: "2026-11-14",
      url: "https://recruit.puruni.com/recruit/notice/view?page=1&idx=9400002",
    });
  });

  it("지역: [서울마포]는 서울, [서대문구]는 서울에만 있는 구라서 서울 서대문구, 대괄호에 지역이 없으면 없음", () => {
    expect(byId("9400004")?.region).toBe("서울");
    expect(byId("9400003")?.region).toBe("서울 서대문구");
    expect(byId("9400001")?.region).toBeUndefined();
  });

  it("어린이집 이름을 제목에서 떼고(괄호가 붙어도 이름만), 접수 기간의 끝 날짜를 마감일로 쓴다", () => {
    expect(byId("9400003")?.orgName).toBe("라마바 어린이집");
    expect(byId("9400001")?.orgName).toBe("차카타어린이집");
    expect(byId("9400004")?.deadline).toBe("2026-10-31");
  });

  it("쪽 번호 중 현재 쪽보다 큰 것이 있으면 다음 쪽이 있다", () => {
    expect(page.hasNext).toBe(true);
    const single = LIST_HTML.replace('<a href="javascript:pageSubmit(2)">2</a>', "");
    expect(parsePuruniList(single).hasNext).toBe(false);
  });

  it("신입·담임 판별: 육아대체교사는 거르고 교사·담임·보육교사 공고는 저장한다", () => {
    expect(page.jobs.filter(isTarget).map((job) => job.sourceId)).toEqual(["9400003", "9400002", "9400001"]);
  });
});

describe("parsePuruniList — 예외", () => {
  it("줄이 하나도 없는 목록은 0건으로 읽는다", () => {
    const html = '<table class="recruit-bbs"><tbody></tbody></table>';
    expect(parsePuruniList(html)).toEqual({ itemCount: 0, hasNext: false, jobs: [] });
  });

  it("목록 표가 없으면 사이트 구조가 바뀐 것으로 보고 오류를 던진다", () => {
    expect(() => parsePuruniList("<html><body>점검 중</body></html>")).toThrow(PuruniError);
  });

  it("공고 번호가 숫자가 아닌 줄은 읽지 않는다", () => {
    const html = LIST_HTML.replace("pageView(1, 9400004)", "pageView(1, x)");
    expect(parsePuruniList(html).jobs.map((job) => job.sourceId)).not.toContain("9400004");
  });
});

describe("buildPuruniUrl", () => {
  it("쪽 번호를 붙인다", () => {
    expect(buildPuruniUrl(2)).toBe("https://recruit.puruni.com/recruit/notice?page=2");
  });
});

/** n개 줄과 쪽 번호 링크(현재 쪽 page, 마지막 쪽 last)를 가진 목록 HTML */
function listHtml(page: number, last: number, base: number, rows = 3): string {
  const items = Array.from({ length: rows }, (_, i) => {
    const idx = base + i;
    return `<tr><td><a href="#" onClick="pageView(${page}, ${idx});">시험${idx}어린이집 교사모집</a></td><td>2026-10-01 ~ 2099-12-31</td></tr>`;
  }).join("");
  const nav = Array.from({ length: last }, (_, i) => i + 1)
    .map((n) => `<a href="javascript:pageSubmit(${n})"${n === page ? ' class="on"' : ""}>${n}</a>`)
    .join("");
  return `<table class="recruit-bbs"><tbody>${items}</tbody></table><div class="pager">${nav}</div>`;
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

const ROBOTS_DISALLOW_ALL = "User-agent: *\nDisallow: /\n";
const pageOf = (url: URL) => Number(url.searchParams.get("page"));
const listCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname !== "/robots.txt");
const robotsCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname === "/robots.txt");

describe("createPuruniCollector", () => {
  it("기본값은 robots.txt를 따른다: 전체 금지이면 목록을 한 번도 요청하지 않고 CrawlNotAllowedError", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? ok(ROBOTS_DISALLOW_ALL) : ok(listHtml(1, 1, 1)));
    const { http, get } = fakeHttp(route);

    await expect(createPuruniCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(CrawlNotAllowedError);
    expect(listCalls(get)).toHaveLength(0);
  });

  it("ignoreRobotsTxt: true이면 robots.txt를 요청하지 않고 목록을 읽는다", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? ok(ROBOTS_DISALLOW_ALL) : ok(listHtml(1, 1, 100, 2)));
    const { http, get } = fakeHttp(route);
    const result = await createPuruniCollector({ http, ignoreRobotsTxt: true }).fetchJobs();

    expect(robotsCalls(get)).toHaveLength(0);
    expect(listCalls(get)).toHaveLength(1);
    expect(result.jobs).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  it("마지막 쪽까지 읽으면 complete: true", async () => {
    const route: Route = (url) => ok(listHtml(pageOf(url), 3, pageOf(url) * 100, 3));
    const { http, get } = fakeHttp(route);
    const result = await createPuruniCollector({ http, ignoreRobotsTxt: true }).fetchJobs();

    expect(listCalls(get).map(pageOf)).toEqual([1, 2, 3]);
    expect(result.jobs).toHaveLength(9);
    expect(result.complete).toBe(true);
  });

  it("쪽 상한에 걸리면 complete: false", async () => {
    const route: Route = (url) => ok(listHtml(pageOf(url), 50, pageOf(url) * 100));
    const { http, get } = fakeHttp(route);
    const result = await createPuruniCollector({ http, ignoreRobotsTxt: true, maxPages: 2 }).fetchJobs();

    expect(listCalls(get)).toHaveLength(2);
    expect(result.complete).toBe(false);
  });

  it("사이트가 접근을 막으면(403) 우회하지 않고 그대로 실패한다", async () => {
    const route: Route = (url) => new HttpError("HTTP 403", 403, url.toString(), 1);
    const { http, get } = fakeHttp(route);

    await expect(createPuruniCollector({ http, ignoreRobotsTxt: true }).fetchJobs()).rejects.toMatchObject({ status: 403 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("구조가 바뀐 응답은 수집 실패로 드러난다", async () => {
    const { http } = fakeHttp(() => ok("<html>개편</html>"));
    await expect(createPuruniCollector({ http, ignoreRobotsTxt: true }).fetchJobs()).rejects.toBeInstanceOf(PuruniError);
  });
});
