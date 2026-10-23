import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { HttpError, type HttpClient, type HttpResponse } from "./http";
import { CrawlNotAllowedError } from "./robots";
import { SamsungError, buildSamsungUrl, createSamsungCollector, parseSamsungContactRegion, parseSamsungList } from "./samsung";

const LIST_HTML = readFileSync(join(__dirname, "__fixtures__/samsung-list.html"), "utf8");

describe("parseSamsungList — 시험용 축약 목록", () => {
  const page = parseSamsungList(LIST_HTML);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("진행 중인 줄만 공고로 읽고(끝난 줄은 뺌), 표 위의 진행 중 건수를 읽는다", () => {
    expect(page.openTotal).toBe(3);
    expect(page.itemCount).toBe(4);
    expect(page.jobs.map((job) => job.sourceId)).toEqual(["9500005", "9500004", "9500003"]);
  });

  it("직종을 제목으로, 어린이집명을 기관명으로 옮기고 원문 링크는 상세를 GET으로 여는 주소로 만든다", () => {
    expect(byId("9500005")).toEqual({
      sourceId: "9500005",
      title: "보육교사(27학년도 정규직 담임교사)",
      orgName: "가나다어린이집",
      deadline: "2026-11-04",
      url: "https://www.samsungwelfare.org/html/welfare/nursery/recruit_view.asp?seq=9500005&page=1&prc_seq=view",
    });
  });

  it("이름의 &nbsp;·&amp;를 풀고 앞뒤 공백을 지운다", () => {
    expect(byId("9500004")?.orgName).toBe("라마바삼성R&D캠퍼스어린이집");
  });

  it("지역 칸이 없어서 어린이집명에 '서울'이 있을 때만 서울로 읽는다", () => {
    expect(byId("9500005")?.region).toBeUndefined();
    const html = LIST_HTML.replace("가나다어린이집&nbsp;", "삼성서울병원어린이집&nbsp;");
    expect(parseSamsungList(html).jobs.find((job) => job.sourceId === "9500005")?.region).toBe("서울");
  });

  it("쪽 이동 링크 중 현재 쪽보다 큰 번호가 있으면 다음 쪽이 있다", () => {
    expect(page.hasNext).toBe(true);
    const single = LIST_HTML.replace(/<a href=javascript:_gotoPage2[^>]*>\d<\/a>\s*/g, "");
    expect(parseSamsungList(single).hasNext).toBe(false);
  });

  it("신입·담임 판별: 정규직 담임교사는 저장하고 대체보육교사와 사무원은 거른다", () => {
    expect(page.jobs.filter(isTarget).map((job) => job.sourceId)).toEqual(["9500005"]);
  });
});

describe("parseSamsungList — 예외", () => {
  it("줄이 하나도 없는 목록은 0건으로 읽는다", () => {
    const html = '<table class="list-tb2"><tbody></tbody></table>';
    expect(parseSamsungList(html)).toEqual({ openTotal: undefined, itemCount: 0, hasNext: false, jobs: [] });
  });

  it("목록 표가 없으면 사이트 구조가 바뀐 것으로 보고 오류를 던진다", () => {
    expect(() => parseSamsungList("<html><body>점검 중</body></html>")).toThrow(SamsungError);
  });

  it("공고 번호가 숫자가 아닌 줄은 읽지 않는다", () => {
    const html = LIST_HTML.replace("_view(9500005,1)", "_view(x,1)");
    expect(parseSamsungList(html).jobs.map((job) => job.sourceId)).not.toContain("9500005");
  });
});

describe("parseSamsungContactRegion", () => {
  it("연락처가 02로 시작하면 서울, 다른 지역번호나 연락처 없음은 알 수 없음", () => {
    expect(parseSamsungContactRegion("<th>연락처</th><td>02-1234-5678</td>")).toBe("서울");
    expect(parseSamsungContactRegion("<th>연락처</th><td>(02) 123-4567</td>")).toBe("서울");
    expect(parseSamsungContactRegion("<th>연락처</th><td>031-218-2935</td>")).toBeUndefined();
    expect(parseSamsungContactRegion("<th>접수처</th><td>test@example.com</td>")).toBeUndefined();
    expect(parseSamsungContactRegion("")).toBeUndefined();
  });
});

describe("buildSamsungUrl", () => {
  it("쪽 번호를 붙인다", () => {
    expect(buildSamsungUrl(2)).toBe("https://www.samsungwelfare.org/html/welfare/nursery/recruit.asp?page=2");
  });
});

/** 진행 중 줄 open개와 끝난 줄 closed개, 표 위 건수(openTotal), 쪽 이동 링크를 가진 목록 HTML */
function listHtml(page: number, last: number, openTotal: number, base: number, open: number, closed = 0): string {
  const openRows = Array.from({ length: open }, (_, i) => {
    const seq = base + i;
    return `<tr><td class="fpd">${i}</td><td><a href="javascript:_view(${seq},${page})">시험${seq}어린이집 <img class='ico-ing' alt='진행중' /></a></td><td>보육교사</td><td>20261001 ~ 20991231</td><td> </td><td>2026.10.01</td><td>1</td></tr>`;
  });
  const closedRows = Array.from({ length: closed }, (_, i) => {
    const seq = base + 500 + i;
    return `<tr><td class="fpd">${i}</td><td><a href="javascript:_view(${seq},${page})">종료${seq}어린이집</a></td><td>보육교사</td><td>20260101 ~ 20260110</td><td>서류전형 완료</td><td>2026.01.01</td><td>1</td></tr>`;
  });
  const nav = Array.from({ length: last }, (_, i) => i + 1)
    .map((n) => (n === page ? `<strong>${n}</strong>` : `<a href=javascript:_gotoPage2(goPage,${n},'recruit.asp?linkparam')>${n}</a>`))
    .join(" ");
  return `<p class="tb-tit04">진행중인 모집 공고 : 총  <span>${openTotal}</span>건</p><table class="list-tb2"><tbody>${[...openRows, ...closedRows].join("")}</tbody></table><div class="paging">${nav}</div>`;
}

function ok(body: string): HttpResponse {
  return { status: 200, body, headers: new Headers(), attempts: 1 };
}

type Route = (url: URL) => HttpResponse | Error;

/** 상세 화면 본문. 연락처 한 줄만 있으면 된다 */
const detailOf = (phone: string) => ok(`<table><tr><th>어린이집명</th><td>시험어린이집</td></tr><tr><th>연락처</th><td>${phone}</td></tr><tr><th>접수처</th><td>test@example.com</td></tr></table>`);

/** 목록 요청은 route가, 상세 요청(recruit_view.asp)은 detail이 답한다. 상세 기본 응답은 서울 전화(02)다 */
function fakeHttp(route: Route, detail: Route = () => detailOf("02-1234-5678")) {
  const get = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    const reply = parsed.pathname.endsWith("recruit_view.asp") ? detail(parsed) : route(parsed);
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { http: { get } as HttpClient, get };
}

const ROBOTS_DISALLOW_ALL = "User-agent: *\nDisallow: /\n";
const pageOf = (url: URL) => Number(url.searchParams.get("page"));
const listCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname.endsWith("recruit.asp"));
const detailCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname.endsWith("recruit_view.asp"));
const robotsCalls = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname === "/robots.txt");

describe("createSamsungCollector", () => {
  it("기본값은 robots.txt를 따른다: 전체 금지이면 목록을 한 번도 요청하지 않고 CrawlNotAllowedError", async () => {
    const route: Route = (url) => (url.pathname === "/robots.txt" ? ok(ROBOTS_DISALLOW_ALL) : ok(listHtml(1, 1, 1, 100, 1)));
    const { http, get } = fakeHttp(route);

    await expect(createSamsungCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(CrawlNotAllowedError);
    expect(listCalls(get)).toHaveLength(0);
  });

  it("ignoreRobotsTxt: true이면 robots.txt를 요청하지 않고 목록을 읽는다", async () => {
    const { http, get } = fakeHttp(() => ok(listHtml(1, 1, 2, 100, 2)));
    const result = await createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs();

    expect(robotsCalls(get)).toHaveLength(0);
    expect(result.jobs).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  it("표 위의 진행 중 건수만큼 읽으면 뒤쪽(끝난 공고)은 요청하지 않고 complete: true", async () => {
    // 1쪽에 진행 중 9건과 끝난 1건, 2쪽에 진행 중 2건, 3~4쪽은 끝난 공고뿐 (총 11건)
    const route: Route = (url) => {
      const page = pageOf(url);
      if (page === 1) return ok(listHtml(1, 4, 11, 1000, 9, 1));
      if (page === 2) return ok(listHtml(2, 4, 11, 2000, 2, 8));
      return ok(listHtml(page, 4, 11, 3000, 0, 10));
    };
    const { http, get } = fakeHttp(route);
    const result = await createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs();

    expect(listCalls(get).map(pageOf)).toEqual([1, 2]);
    expect(result.jobs).toHaveLength(11);
    expect(result.complete).toBe(true);
  });

  it("건수만큼 못 읽었는데 진행 중인 공고가 하나도 없는 쪽을 만나면 멈추고 complete: false", async () => {
    const route: Route = (url) => (pageOf(url) === 1 ? ok(listHtml(1, 4, 20, 1000, 3, 7)) : ok(listHtml(pageOf(url), 4, 20, 2000, 0, 10)));
    const { http, get } = fakeHttp(route);
    const result = await createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs();

    expect(listCalls(get).map(pageOf)).toEqual([1, 2]);
    expect(result.jobs).toHaveLength(3);
    expect(result.complete).toBe(false);
  });

  it("쪽 상한에 걸리면 complete: false", async () => {
    const route: Route = (url) => ok(listHtml(pageOf(url), 50, 500, pageOf(url) * 1000, 10));
    const { http, get } = fakeHttp(route);
    const result = await createSamsungCollector({ http, ignoreRobotsTxt: true, maxPages: 2 }).fetchJobs();

    expect(listCalls(get)).toHaveLength(2);
    expect(result.complete).toBe(false);
  });

  it("사이트가 접근을 막으면(403) 우회하지 않고 그대로 실패한다", async () => {
    const { http, get } = fakeHttp((url) => new HttpError("HTTP 403", 403, url.toString(), 1));
    await expect(createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs()).rejects.toMatchObject({ status: 403 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("지역을 모르는 신입·담임 후보는 상세의 연락처 지역번호가 02일 때만 서울로 본다", async () => {
    const detail: Route = (url) => detailOf(url.searchParams.get("seq") === "100" ? "02-1234-5678" : "031-218-2935");
    const { http, get } = fakeHttp(() => ok(listHtml(1, 1, 2, 100, 2)), detail);
    const result = await createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs();

    expect(detailCalls(get).map((url) => url.searchParams.get("seq"))).toEqual(["100", "101"]);
    expect(result.jobs.map((job) => job.region)).toEqual(["서울", undefined]);
  });

  it("후보가 아닌 공고(대체교사)는 상세를 요청하지 않는다", async () => {
    const html = listHtml(1, 1, 1, 100, 1).replace("<td>보육교사</td>", "<td>출산휴가 및 육아휴직대체보육교사</td>");
    const { http, get } = fakeHttp(() => ok(html));
    await createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs();
    expect(detailCalls(get)).toHaveLength(0);
  });

  it("상세가 없거나(404) 서버 오류여도 그 공고만 지역 없음으로 두고, 접근을 막으면(403) 실패한다", async () => {
    const list = () => ok(listHtml(1, 1, 1, 100, 1));
    const notFound = fakeHttp(list, (url) => new HttpError("HTTP 404", 404, url.toString(), 1));
    const result = await createSamsungCollector({ http: notFound.http, ignoreRobotsTxt: true }).fetchJobs();
    expect(result.jobs[0].region).toBeUndefined();

    const forbidden = fakeHttp(list, (url) => new HttpError("HTTP 403", 403, url.toString(), 1));
    await expect(createSamsungCollector({ http: forbidden.http, ignoreRobotsTxt: true }).fetchJobs()).rejects.toMatchObject({ status: 403 });
  });

  it("구조가 바뀐 응답은 수집 실패로 드러난다", async () => {
    const { http } = fakeHttp(() => ok("<html>개편</html>"));
    await expect(createSamsungCollector({ http, ignoreRobotsTxt: true }).fetchJobs()).rejects.toBeInstanceOf(SamsungError);
  });
});
