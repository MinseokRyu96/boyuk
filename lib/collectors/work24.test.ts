import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import type { HttpClient } from "./http";
import { WORK24_LIST_URL, Work24ApiError, buildWork24Url, createWork24Collector, parseWork24List } from "./work24";

const FIXTURE = readFileSync(join(__dirname, "__fixtures__/work24-list.xml"), "utf8");

describe("parseWork24List — 샘플 응답", () => {
  const page = parseWork24List(FIXTURE);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("총 건수와 항목 수를 읽는다. 링크가 없거나 위험한 항목은 jobs에서 뺀다", () => {
    expect(page.total).toBe(7);
    expect(page.itemCount).toBe(7);
    expect(page.jobs.map((job) => job.sourceId)).toEqual([
      "K150012510010001",
      "K150012510020002",
      "K150012510030003",
      "K150012510040004",
      "K150012510050005",
    ]);
  });

  it("필드를 공통 형식으로 옮긴다 (두 자리 연도 마감일, 엔티티가 풀린 링크)", () => {
    expect(byId("K150012510010001")).toEqual({
      sourceId: "K150012510010001",
      title: "[신입 가능] 만 1세반 담임교사 모집",
      orgName: "해오름어린이집",
      region: "서울 강서구",
      deadline: "2025-10-31",
      url: "https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K150012510010001&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet",
      rawText: "신입",
      contextText: "어린이집",
      careerHint: "new",
    });
  });

  it("CDATA와 &amp;를 풀고, '채용시까지'는 마감일 없음으로 둔다", () => {
    const job = byId("K150012510020002");
    expect(job?.title).toBe("보육교사 채용 (경력 무관) & 4대보험");
    expect(job?.deadline).toBeUndefined();
    expect(job?.careerHint).toBe("any");
    expect(byId("K150012510040004")?.orgName).toBe("A&B 어린이집");
  });

  it("경력 값에서 경력 구분을 읽는다", () => {
    expect(byId("K150012510030003")?.careerHint).toBe("experienced");
    expect(byId("K150012510020002")?.careerHint).toBe("any");
  });

  it("근무지역 태그가 없으면 주소에서 시·구를 뽑는다", () => {
    expect(byId("K150012510040004")?.region).toBe("경기 수원시");
  });

  it("신입·담임 판별과 이어 붙이면 수락 기준(F5)대로 걸러진다", () => {
    const targets = page.jobs.filter(isTarget).map((job) => job.sourceId);
    expect(targets).toContain("K150012510010001"); // 신입 가능 담임
    expect(targets).toContain("K150012510020002"); // 경력 무관 보육교사
    expect(targets).not.toContain("K150012510030003"); // 경력 3년 이상
    expect(targets).not.toContain("K150012510040004"); // 조리원
  });
});

describe("parseWork24List — 모양이 다른 응답", () => {
  it("항목이 하나뿐이어도 목록으로 읽는다", () => {
    const xml = `<wantedRoot><total>1</total><wanted><wantedAuthNo>K1</wantedAuthNo><title>신입 보육교사</title><wantedInfoUrl>https://www.work24.go.kr/a</wantedInfoUrl></wanted></wantedRoot>`;
    const page = parseWork24List(xml);
    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0].sourceId).toBe("K1");
  });

  it("결과가 없으면 빈 목록이다", () => {
    expect(parseWork24List("<wantedRoot><total>0</total></wantedRoot>")).toMatchObject({ total: 0, itemCount: 0, jobs: [] });
    expect(parseWork24List("<wantedRoot></wantedRoot>")).toMatchObject({ total: 0, itemCount: 0, jobs: [] });
  });

  it("구인인증번호가 없으면 링크의 해시를 ID로 쓴다", () => {
    const xml = `<wantedRoot><total>1</total><wanted><title>신입 보육교사</title><wantedInfoUrl>https://www.work24.go.kr/a?x=1</wantedInfoUrl></wanted></wantedRoot>`;
    const [job] = parseWork24List(xml).jobs;
    expect(job.sourceId).toMatch(/^[0-9a-f]{20}$/);
  });

  it("wantedRoot가 없는 응답(오류 등)은 내용을 담아 오류로 던진다", () => {
    const error = (() => {
      try {
        parseWork24List("<error><message>인증키가 올바르지 않아요</message></error>");
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(Work24ApiError);
    expect((error as Error).message).toContain("인증키가 올바르지 않아요");
    expect((error as Error).message).toContain("error");
  });

  it("XML이 아닌 응답도 오류로 던진다", () => {
    expect(() => parseWork24List("<html><body>점검 중</body></html>")).toThrow(Work24ApiError);
    expect(() => parseWork24List("")).toThrow(Work24ApiError);
  });
});

describe("buildWork24Url", () => {
  it("필수 파라미터를 채우고 한글은 공백을 %20으로 인코딩한다", () => {
    const url = buildWork24Url({ authKey: "KEY", startPage: 2, display: 100, keyword: "어린이집 보육교사", career: "N", region: "11000" });
    expect(url.startsWith(`${WORK24_LIST_URL}?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      authKey: "KEY",
      callTp: "L",
      returnType: "XML",
      startPage: "2",
      display: "100",
      keyword: "어린이집 보육교사",
      career: "N",
      region: "11000",
    });
    expect(url).toContain(`keyword=${encodeURIComponent("어린이집 보육교사")}`);
    expect(url).not.toContain("+");
  });

  it("선택 조건을 생략하면 파라미터에서 뺀다", () => {
    const q = new URL(buildWork24Url({ authKey: "KEY", startPage: 1, display: 10 })).searchParams;
    expect([...q.keys()].sort()).toEqual(["authKey", "callTp", "display", "returnType", "startPage"]);
  });
});

/** 고용24 목록 응답을 흉내 낸다 */
function wanted(id: string, career?: string): string {
  const careerTag = career === undefined ? "" : `<career>${career}</career>`;
  return `<wanted><wantedAuthNo>${id}</wantedAuthNo><company>${id} 어린이집</company><title>${id} 담임교사 신입</title>${careerTag}<wantedInfoUrl>https://www.work24.go.kr/x?id=${id}</wantedInfoUrl></wanted>`;
}
function root(total: number, items: string[]): string {
  return `<wantedRoot><total>${total}</total><startPage>1</startPage><display>2</display>${items.join("")}</wantedRoot>`;
}
function fakeHttp(handler: (url: URL) => string) {
  const get = vi.fn(async (url: string) => ({ status: 200, body: handler(new URL(url)), headers: new Headers(), attempts: 1 }));
  return { http: { get } satisfies HttpClient, get };
}
const requested = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url).searchParams);

describe("createWork24Collector", () => {
  const base = { getAuthKey: () => "KEY", display: 2 } as const;

  it("검색어 × 경력 조합마다 요청한다", async () => {
    const { http, get } = fakeHttp(() => root(1, [wanted("A", "신입")]));
    await createWork24Collector({ ...base, http, keywords: ["보육교사", "담임교사"], careers: ["N", "Z"] }).fetchJobs();
    const calls = requested(get).map((q) => `${q.get("keyword")}|${q.get("career")}`);
    expect(calls).toEqual(["보육교사|N", "보육교사|Z", "담임교사|N", "담임교사|Z"]);
    expect(requested(get).every((q) => q.get("authKey") === "KEY")).toBe(true);
  });

  it("결과가 한 쪽을 넘으면 다음 쪽을 이어서 가져오고, 총 건수를 채우면 멈춘다", async () => {
    const pages: Record<string, string[]> = { "1": ["A", "B"], "2": ["C", "D"], "3": ["E"] };
    const { http, get } = fakeHttp((url) => root(5, (pages[url.searchParams.get("startPage") ?? ""] ?? []).map((id) => wanted(id, "신입"))));
    const result = await createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N"] }).fetchJobs();
    expect(result.jobs.map((job) => job.sourceId)).toEqual(["A", "B", "C", "D", "E"]);
    expect(result.complete).toBe(true);
    expect(requested(get).map((q) => q.get("startPage"))).toEqual(["1", "2", "3"]);
  });

  it("마지막 쪽이 꽉 차 있어도 총 건수에 닿으면 빈 요청을 더 보내지 않는다", async () => {
    const pages: Record<string, string[]> = { "1": ["A", "B"], "2": ["C", "D"] };
    const { http, get } = fakeHttp((url) => root(4, (pages[url.searchParams.get("startPage") ?? ""] ?? []).map((id) => wanted(id, "신입"))));
    const result = await createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N"] }).fetchJobs();
    expect(result.jobs).toHaveLength(4);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("여러 요청에서 같은 공고가 나오면 하나로 합친다", async () => {
    const { http } = fakeHttp(() => root(2, [wanted("A", "신입"), wanted("B", "신입")]));
    const result = await createWork24Collector({ ...base, http, keywords: ["보육교사", "담임교사"], careers: ["N", "Z"] }).fetchJobs();
    expect(result.jobs.map((job) => job.sourceId)).toEqual(["A", "B"]);
  });

  it("응답에 경력 값이 없으면 요청한 경력 조건으로 구분을 채우고, 응답 값이 있으면 그것이 우선한다", async () => {
    const { http } = fakeHttp((url) =>
      url.searchParams.get("career") === "N" ? root(2, [wanted("N1"), wanted("N2", "경력")]) : root(1, [wanted("Z1")]),
    );
    const result = await createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N", "Z"] }).fetchJobs();
    const hint = Object.fromEntries(result.jobs.map((job) => [job.sourceId, job.careerHint]));
    expect(hint).toEqual({ N1: "new", N2: "experienced", Z1: "any" });
  });

  it("쪽 상한에 막히면 일부만 가져온 것으로 표시한다", async () => {
    const { http, get } = fakeHttp(() => root(100, [wanted(`P${Math.random()}`, "신입"), wanted(`Q${Math.random()}`, "신입")]));
    const result = await createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N"], maxPagesPerQuery: 2 }).fetchJobs();
    expect(result.complete).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("다음 쪽을 요청해도 새 공고가 없으면(같은 쪽 반복) 멈추고 일부만 가져온 것으로 표시한다", async () => {
    const { http, get } = fakeHttp(() => root(10, [wanted("A", "신입"), wanted("B", "신입")]));
    const result = await createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N"] }).fetchJobs();
    expect(result.jobs).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("지역 코드를 주면 코드마다 따로 요청한다", async () => {
    const { http, get } = fakeHttp(() => root(0, []));
    await createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N"], regionCodes: ["11000", "41000"] }).fetchJobs();
    expect(requested(get).map((q) => q.get("region"))).toEqual(["11000", "41000"]);
  });

  it("인증키가 없으면 요청하지 않고 안내와 함께 오류를 던진다", async () => {
    const { http, get } = fakeHttp(() => root(0, []));
    await expect(createWork24Collector({ getAuthKey: () => undefined, http }).fetchJobs()).rejects.toThrow(/WORK24_API_KEY/);
    expect(get).not.toHaveBeenCalled();
  });

  it("예상 밖 응답은 오류로 전달한다 (수집 실패로 기록되도록)", async () => {
    const { http } = fakeHttp(() => "<error><message>사용 한도 초과</message></error>");
    await expect(createWork24Collector({ ...base, http, keywords: ["보육교사"], careers: ["N"] }).fetchJobs()).rejects.toThrow(/사용 한도 초과/);
  });

  it("범용 채용 소스라서 어린이집 맥락 검사를 요구한다", () => {
    const collector = createWork24Collector({ ...base, http: fakeHttp(() => root(0, [])).http });
    expect(collector).toMatchObject({ source: "work24", isWorkplace: false, needsChildcareContext: true });
  });
});
