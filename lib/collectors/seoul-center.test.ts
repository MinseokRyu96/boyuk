import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { HttpError, type HttpClient, type HttpResponse } from "./http";
import { CrawlNotAllowedError } from "./robots";
import {
  SEOUL_CENTER_LIST_URL,
  SeoulCenterError,
  buildSeoulCenterUrl,
  createSeoulCenterCollector,
  parseSeoulCenterList,
} from "./seoul-center";

const LIST_HTML = readFileSync(join(__dirname, "__fixtures__/seoul-center-list.html"), "utf8");
const EMPTY_HTML = readFileSync(join(__dirname, "__fixtures__/seoul-center-empty.html"), "utf8");

describe("parseSeoulCenterList — 시험용 축약 목록", () => {
  const page = parseSeoulCenterList(LIST_HTML);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("총 건수와 공고 행 수를 읽고, ID가 없는 안내 행은 세지 않는다", () => {
    expect(page.total).toBe(1463);
    expect(page.itemCount).toBe(6);
    expect(page.jobs.map((job) => job.sourceId)).toEqual(["9000006", "9000005", "9000004", "9000003", "9000002", "9000001"]);
  });

  it("필드를 공통 형식으로 옮긴다 (원문 링크는 숫자 ID로 만든 상세 주소)", () => {
    expect(byId("9000005")).toEqual({
      sourceId: "9000005",
      title: "[신입 환영] 만 1세 담임교사 모집",
      orgName: "구립라마바어린이집",
      region: "서울 강동구",
      deadline: "2026-11-07",
      url: "https://seoul.childcare.go.kr/ccef/job/JobOfferSl.jsp?flag=Sl&JOSEQ=9000005",
      rawText: "보육교사",
      facilityType: "국공립",
      isWorkplace: false,
    });
  });

  it("표에서 잘린 제목 대신 title 속성의 전체 제목을 쓰고, 어린이집 이름의 앞뒤 공백을 지운다", () => {
    expect(byId("9000004")?.title).toBe("사아자어린이집 연장보육 전담교사(연장교사) 채용 공고");
    expect(byId("9000003")?.title).toBe("차카타병원어린이집 보조 선생님 구인합니다");
    expect(byId("9000006")?.orgName).toBe("가나다어린이집");
    expect(byId("9000003")?.orgName).toBe("차카타병원 어린이집");
  });

  it("유형 열을 어린이집 유형으로 옮긴다 (민간·가정 제외 판별용)", () => {
    expect(page.jobs.map((job) => job.facilityType)).toEqual(["가정", "국공립", "국공립", "직장", "직장", "민간"]);
  });

  it("유형이 직장인 공고만 직장어린이집으로 표시한다", () => {
    expect(page.jobs.filter((job) => job.isWorkplace).map((job) => job.sourceId)).toEqual(["9000003", "9000002"]);
  });

  it("지역은 시·도와 구까지만, 마감일이 비어 있으면 마감일 없음", () => {
    expect(byId("9000002")?.region).toBe("서울 성동구");
    expect(byId("9000001")?.region).toBe("경기 성남시");
    expect(byId("9000001")?.deadline).toBeUndefined();
  });

  it("신입·담임 판별: 담임은 저장하고 연장전담·보조 선생님·경력 3년 이상은 거른다", () => {
    const targets = page.jobs.filter(isTarget).map((job) => job.sourceId);
    expect(targets).toEqual(["9000006", "9000005", "9000001"]);
  });
});

describe("parseSeoulCenterList — 예외", () => {
  it("결과가 없는 응답은 0건으로 읽는다", () => {
    expect(parseSeoulCenterList(EMPTY_HTML)).toEqual({ total: 0, itemCount: 0, jobs: [] });
  });

  it("목록 표나 총 건수가 없으면 사이트 구조가 바뀐 것으로 보고 오류를 던진다", () => {
    expect(() => parseSeoulCenterList("<html><body><p>점검 중입니다</p></body></html>")).toThrow(SeoulCenterError);
    expect(() => parseSeoulCenterList("")).toThrow(/구조가 바뀌었는지/);
  });

  it("상세 ID가 숫자가 아닌 행은 읽지 않는다", () => {
    const html = LIST_HTML.replace("fnGoBoardSl('9000006')", "fnGoBoardSl('x\"><script>')");
    const ids = parseSeoulCenterList(html).jobs.map((job) => job.sourceId);
    expect(ids).not.toContain("9000006");
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });
});

describe("buildSeoulCenterUrl", () => {
  it("구인 중(endYn=N) 조건과 직종, offset을 붙인다", () => {
    expect(buildSeoulCenterUrl({ offset: 20, jobCode: "32" })).toBe(
      `${SEOUL_CENTER_LIST_URL}?flag=SlPL&offset=20&endYn=N&schEmpGbCode=32`,
    );
  });

  it("직종을 주지 않으면 직종 조건을 뺀다", () => {
    expect(buildSeoulCenterUrl({ offset: 0 })).toBe(`${SEOUL_CENTER_LIST_URL}?flag=SlPL&offset=0&endYn=N`);
  });
});

/** offset마다 행 n개짜리 목록 HTML을 만든다. 번호는 start부터 이어진다 */
function listHtml(total: number, offset: number, rows: number): string {
  const body = Array.from({ length: rows }, (_, i) => {
    const id = 7_000_000 + offset + i;
    return `<tr><td>${id}</td><td>가정</td>
      <td><a href="#" title="담임교사 ${id}" onclick="fnGoBoardSl('${id}'); return false;">담임교사 ${id}</a></td>
      <td class="lef"><a href="#">시험${id}어린이집</a></td><td>보육교사</td><td>서울특별시 마포구</td><td>2099-12-31</td><td>2026-10-23</td><td>1</td></tr>`;
  }).join("");
  return `<div class="com_txt2">※ 총 ${total} 건이 검색되었습니다.</div>
    <div class="com_list1"><table><thead><tr><th>번호</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function ok(body: string): HttpResponse {
  return { status: 200, body, headers: new Headers(), attempts: 1 };
}

type Route = (url: string) => HttpResponse | Error;

function fakeHttp(route: Route) {
  const get = vi.fn(async (url: string) => {
    const reply = route(url);
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { http: { get } as HttpClient, get };
}

/** robots.txt는 없고(404), 목록은 총 total건을 10건씩 돌려주는 사이트 */
function siteWith(total: number): Route {
  return (url) => {
    if (url.endsWith("/robots.txt")) return new HttpError("HTTP 404", 404, url, 1);
    const offset = Number(new URL(url).searchParams.get("offset"));
    return ok(listHtml(total, offset, Math.max(0, Math.min(10, total - offset))));
  };
}

const listCalls = (get: ReturnType<typeof fakeHttp>["get"]) =>
  get.mock.calls.map(([url]) => url).filter((url) => !url.endsWith("/robots.txt"));

describe("createSeoulCenterCollector", () => {
  it("robots.txt를 먼저 확인하고, 끝까지 읽으면 complete: true", async () => {
    const { http, get } = fakeHttp(siteWith(25));
    const result = await createSeoulCenterCollector({ http }).fetchJobs();

    expect(get.mock.calls[0][0]).toBe("https://seoul.childcare.go.kr/robots.txt");
    expect(listCalls(get)).toHaveLength(3); // 10 + 10 + 5건
    expect(result.complete).toBe(true);
    expect(result.jobs).toHaveLength(25);
    expect(result.jobs[0]).toMatchObject({ sourceId: "7000000", orgName: "시험7000000어린이집", region: "서울 마포구" });
  });

  it("쪽 상한에 걸리면 complete: false (목록 일부만 읽음)", async () => {
    const { http, get } = fakeHttp(siteWith(1463));
    const result = await createSeoulCenterCollector({ http, maxPages: 3 }).fetchJobs();

    expect(listCalls(get)).toHaveLength(3);
    expect(result.jobs).toHaveLength(30);
    expect(result.complete).toBe(false);
  });

  it("쪽 상한과 목록 끝이 같은 쪽이면 끝까지 읽은 것으로 본다", async () => {
    const { http } = fakeHttp(siteWith(20));
    const result = await createSeoulCenterCollector({ http, maxPages: 2 }).fetchJobs();
    expect(result.jobs).toHaveLength(20);
    expect(result.complete).toBe(true);
  });

  it("같은 공고가 여러 쪽에 겹쳐 나와도 한 번만 담는다", async () => {
    // 읽는 동안 새 공고가 올라와 목록이 밀리면 이전 쪽의 마지막 행이 다음 쪽 첫 행으로 다시 나온다
    const route: Route = (url) => {
      if (url.endsWith("/robots.txt")) return new HttpError("HTTP 404", 404, url, 1);
      const offset = Number(new URL(url).searchParams.get("offset"));
      return ok(listHtml(15, Math.max(0, offset - 1), offset === 0 ? 10 : 6));
    };
    const { http } = fakeHttp(route);
    const result = await createSeoulCenterCollector({ http }).fetchJobs();
    expect(new Set(result.jobs.map((job) => job.sourceId)).size).toBe(result.jobs.length);
    expect(result.jobs).toHaveLength(15);
  });

  it("같은 쪽이 반복돼 새 공고가 없으면 멈추고 일부만 읽은 것으로 본다", async () => {
    const route: Route = (url) => (url.endsWith("/robots.txt") ? new HttpError("HTTP 404", 404, url, 1) : ok(listHtml(500, 0, 10)));
    const { http, get } = fakeHttp(route);
    const result = await createSeoulCenterCollector({ http, maxPages: 10 }).fetchJobs();

    expect(listCalls(get)).toHaveLength(2);
    expect(result.jobs).toHaveLength(10);
    expect(result.complete).toBe(false);
  });

  it("robots.txt가 막으면 목록을 한 번도 요청하지 않고 CrawlNotAllowedError", async () => {
    const route: Route = (url) => (url.endsWith("/robots.txt") ? ok("User-agent: *\nDisallow: /\n") : ok(listHtml(10, 0, 10)));
    const { http, get } = fakeHttp(route);

    await expect(createSeoulCenterCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(CrawlNotAllowedError);
    expect(listCalls(get)).toHaveLength(0);
  });

  it("직종 코드가 여럿이면 코드마다 따로 읽는다", async () => {
    const { http, get } = fakeHttp(siteWith(10));
    const result = await createSeoulCenterCollector({ http, jobCodes: ["32", "30"] }).fetchJobs();

    expect(listCalls(get).map((url) => new URL(url).searchParams.get("schEmpGbCode"))).toEqual(["32", "30"]);
    expect(result.jobs).toHaveLength(10); // 두 직종이 같은 응답을 줘도 같은 ID는 한 번만
  });

  it("구조가 바뀐 응답은 수집 실패로 드러난다", async () => {
    const route: Route = (url) => (url.endsWith("/robots.txt") ? new HttpError("HTTP 404", 404, url, 1) : ok("<html>개편</html>"));
    const { http } = fakeHttp(route);
    await expect(createSeoulCenterCollector({ http }).fetchJobs()).rejects.toBeInstanceOf(SeoulCenterError);
  });
});
