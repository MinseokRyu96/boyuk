import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import {
  HANSOL_LIST_URL,
  HansolError,
  buildHansolUrl,
  createHansolCollector,
  parseHansolList,
} from "./hansol";
import { HttpError, type HttpClient, type HttpResponse } from "./http";
import { CrawlNotAllowedError } from "./robots";

const LIST_HTML = readFileSync(join(__dirname, "__fixtures__/hansol-list.html"), "utf8");

describe("parseHansolList — 시험용 축약 목록", () => {
  const page = parseHansolList(LIST_HTML);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("마감 줄과 지원 안내 공지는 공고로 읽지 않고, 줄 수에는 센다", () => {
    expect(page.itemCount).toBe(7);
    expect(page.jobs.map((job) => job.sourceId)).toEqual(["9300007", "9300005", "9300004", "9300003", "9300002"]);
  });

  it("필드를 공통 형식으로 옮기고, 원문 링크는 상세를 보여 주는 GET 주소로 만든다", () => {
    expect(byId("9300005")).toEqual({
      sourceId: "9300005",
      title: "가나다어린이집 영아반 담임교사 채용공고(계약직)",
      orgName: "가나다어린이집",
      region: undefined,
      deadline: "2026-11-06",
      url: "https://docu.hansolhope.or.kr/recruit/index.do?flg=view&mCurrent=2&sCurrent=3&empmn_sn=9300005",
    });
  });

  it("접수 기간의 끝 날짜를 마감일로 쓴다", () => {
    expect(byId("9300007")?.deadline).toBe("2026-11-05");
    expect(byId("9300003")?.deadline).toBe("2026-11-08");
  });

  it("제목 대괄호의 시·도를 지역으로 쓰고, '[전국]'은 지역으로 보지 않는다", () => {
    expect(byId("9300003")?.region).toBe("서울");
    expect(byId("9300007")?.region).toBeUndefined();
  });

  it("쪽 이동 링크가 현재 쪽보다 뒤에 있으면 다음 쪽이 있다", () => {
    expect(page.hasNext).toBe(true);
    const last = LIST_HTML.replace(/<li><a href="javascript:gfnPageNaviClick\('[23]'\);">[23]<\/a><\/li>\s*/g, "");
    expect(parseHansolList(last).hasNext).toBe(false);
    // 앞쪽으로 가는 링크만 있어도 다음 쪽은 없다
    const lastWithPrev = last.replace('<ul><li class="on"><strong title="현재페이지">1</strong></li>', "<ul><li><a href=\"javascript:gfnPageNaviClick('1');\">1</a></li><li class=\"on\"><strong>2</strong></li>");
    expect(parseHansolList(lastWithPrev).hasNext).toBe(false);
  });

  it("신입·담임 판별: 담임·정기채용은 저장하고 대체교사와 안내글(직무 없음)은 거른다", () => {
    expect(page.jobs.filter(isTarget).map((job) => job.sourceId)).toEqual(["9300007", "9300005", "9300003"]);
  });
});

describe("parseHansolList — 예외", () => {
  it("목록 표가 없으면 사이트 구조가 바뀐 것으로 보고 오류를 던진다", () => {
    expect(() => parseHansolList("<html><body>점검 중</body></html>")).toThrow(HansolError);
  });

  it("공고 번호가 숫자가 아닌 줄은 읽지 않는다", () => {
    const html = LIST_HTML.replace("fnView('9300005', '001' )", "fnView('x\"><b>', '001' )");
    const ids = parseHansolList(html).jobs.map((job) => job.sourceId);
    expect(ids).not.toContain("9300005");
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });
});

describe("buildHansolUrl", () => {
  it("교사채용 목록에서 접수 중인 공고(STTUS=001)만 10건씩, 쪽 번호를 붙여 읽는다", () => {
    expect(buildHansolUrl(3)).toBe(`${HANSOL_LIST_URL}?flg=list&mCurrent=2&sCurrent=1&empmn_sn=&pageNum=3&listNum=10&STTUS=001`);
  });
});

/** n개 줄과 쪽 이동 링크(현재 쪽 page, 마지막 쪽 last)를 가진 목록 HTML */
function listHtml(page: number, last: number, base: number, rows = 10): string {
  const items = Array.from({ length: rows }, (_, i) => {
    const sn = base + i;
    return `<tr><td>${i + 1}</td><td>수시</td><td class="tl"><a href="javascript:fnView('${sn}', '001' );">시험${sn}어린이집 담임교사 채용공고</a></td><td>2026-10-01 ~ 2099-12-31</td><td><img alt="접수중" /></td></tr>`;
  }).join("");
  const nav = Array.from({ length: last }, (_, i) => i + 1)
    .map((n) => (n === page ? `<li class="on"><strong>${n}</strong></li>` : `<li><a href="javascript:gfnPageNaviClick('${n}');">${n}</a></li>`))
    .join("");
  return `<table class="tblTypeA"><tbody><tr><th>번호</th></tr>${items}</tbody></table><div class="page_num"><ul>${nav}</ul></div>`;
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

const listCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname !== "/robots.txt");
const noRobots = (url: URL) => new HttpError("HTTP 404", 404, url.toString(), 1);
const pageOf = (url: URL) => Number(url.searchParams.get("pageNum"));

describe("createHansolCollector", () => {
  it("robots.txt(없음)를 먼저 확인하고, 마지막 쪽까지 읽으면 complete: true", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? noRobots(url) : ok(listHtml(pageOf(url), 3, pageOf(url) * 100, pageOf(url) === 3 ? 4 : 10)));
    const { http, get } = fakeHttp(route);
    const result = await createHansolCollector({ http }).fetchJobs();

    expect(get.mock.calls[0][0]).toBe("https://docu.hansolhope.or.kr/robots.txt");
    expect(listCalls(get).map(pageOf)).toEqual([1, 2, 3]);
    expect(listCalls(get).every((url) => url.searchParams.get("STTUS") === "001")).toBe(true);
    expect(result.jobs).toHaveLength(24);
    expect(result.complete).toBe(true);
  });

  it("쪽이 하나뿐이면 한 번만 읽는다", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? noRobots(url) : ok(listHtml(1, 1, 100, 6)));
    const { http, get } = fakeHttp(route);
    const result = await createHansolCollector({ http }).fetchJobs();
    expect(listCalls(get)).toHaveLength(1);
    expect(result).toMatchObject({ complete: true });
    expect(result.jobs).toHaveLength(6);
  });

  it("쪽 상한에 걸리면 complete: false", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? noRobots(url) : ok(listHtml(pageOf(url), 50, pageOf(url) * 100)));
    const { http, get } = fakeHttp(route);
    const result = await createHansolCollector({ http, maxPages: 2 }).fetchJobs();

    expect(listCalls(get)).toHaveLength(2);
    expect(result.complete).toBe(false);
  });

  it("robots.txt가 막으면 목록을 한 번도 요청하지 않고 CrawlNotAllowedError", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? ok("User-agent: *\nDisallow: /\n") : ok(listHtml(1, 1, 1)));
    const { http, get } = fakeHttp(route);

    await expect(createHansolCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(CrawlNotAllowedError);
    expect(listCalls(get)).toHaveLength(0);
  });

  it("구조가 바뀐 응답은 수집 실패로 드러난다", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? noRobots(url) : ok("<html>개편</html>"));
    const { http } = fakeHttp(route);
    await expect(createHansolCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(HansolError);
  });
});
