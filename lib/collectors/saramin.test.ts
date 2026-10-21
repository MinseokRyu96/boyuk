import { describe, expect, it, vi } from "vitest";
import { isChildcareContext, isTarget } from "../normalize";
import { saraminFixtureBody, saraminQuotaErrorBody, saraminSearchFixture } from "./__fixtures__/saramin";
import { HttpError, type HttpClient } from "./http";
import {
  SARAMIN_SEARCH_URL,
  SaraminApiError,
  buildSaraminUrl,
  createSaraminCollector,
  parseSaraminResponse,
} from "./saramin";

describe("parseSaraminResponse — 샘플 응답", () => {
  const page = parseSaraminResponse(saraminFixtureBody);
  const byId = (id: string) => page.jobs.find((job) => job.sourceId === id);

  it("총 건수(문자열)와 항목 수를 읽고, 마감된 공고(active 0)와 위험한 링크는 뺀다", () => {
    expect(page.total).toBe(8);
    expect(page.itemCount).toBe(8);
    expect(page.jobs.map((job) => job.sourceId)).toEqual(["27000001", "27000002", "27000003", "27000004", "27000007", "27000008"]);
  });

  it("필드를 공통 형식으로 옮기고, 원문 링크는 추적 파라미터까지 그대로 둔다", () => {
    expect(byId("27000001")).toEqual({
      sourceId: "27000001",
      title: "[신입 가능] 만 1세반 담임교사 모집",
      orgName: "해오름어린이집",
      region: "서울 강서구",
      deadline: "2025-10-31",
      url: "http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000001&utm_source=job-search-api&utm_medium=api&utm_campaign=saramin-job-search-api",
      rawText: "신입 보육교사",
      contextText: "어린이집 교육",
      careerHint: "new",
    });
  });

  it("마감일은 접수 마감일(close-type 1)일 때만 한국 시간 날짜로 쓴다. 상시·채용시는 마감일 없음", () => {
    expect(byId("27000001")?.deadline).toBe("2025-10-31");
    expect(byId("27000002")?.deadline).toBeUndefined(); // 상시
    expect(byId("27000008")?.deadline).toBeUndefined(); // 채용시
  });

  it("경력 코드를 경력 구분으로 바꾼다 (0 무관, 1 신입, 2 경력, 3 신입/경력)", () => {
    expect(byId("27000001")?.careerHint).toBe("new");
    expect(byId("27000002")?.careerHint).toBe("any");
    expect(byId("27000003")?.careerHint).toBe("experienced");
    expect(byId("27000004")?.careerHint).toBe("any");
    expect(byId("27000007")?.careerHint).toBe("new"); // 코드가 문자열 "1"이어도 읽는다
  });

  it("여러 지역이 오면 첫 번째를, 이스케이프된 구분자도 읽는다", () => {
    expect(byId("27000002")?.region).toBe("서울 마포구");
    expect(byId("27000003")?.region).toBe("경기 성남시");
    expect(byId("27000007")?.region).toBe("서울 양천구");
  });

  it("기관명은 company.detail.name을 쓰고, 없으면 company.name을 쓴다", () => {
    expect(byId("27000001")?.orgName).toBe("해오름어린이집");
    expect(byId("27000007")?.orgName).toBe("A&B 어린이집");
  });

  it("판별과 어린이집 맥락 검사를 이어 붙이면 어린이집의 신입·담임 공고만 남는다", () => {
    const kept = page.jobs.filter((job) => isTarget(job) && isChildcareContext(job)).map((job) => job.sourceId);
    expect(kept).toContain("27000001"); // 신입 가능 담임
    expect(kept).toContain("27000002"); // 경력 무관 보육교사
    expect(kept).toContain("27000008"); // 채용시 마감, 신입/경력
    expect(kept).not.toContain("27000003"); // 경력자만
    expect(kept).not.toContain("27000004"); // 학원 담임교사
  });
});

describe("parseSaraminResponse — 다른 모양과 오류", () => {
  it("공고가 하나뿐이어도(배열이 아니어도) 읽는다", () => {
    const [only] = saraminSearchFixture.jobs.job;
    const page = parseSaraminResponse(JSON.stringify({ jobs: { count: 1, start: 0, total: "1", job: only } }));
    expect(page.jobs).toHaveLength(1);
  });

  it("결과가 없으면 빈 목록이다", () => {
    expect(parseSaraminResponse(JSON.stringify({ jobs: { count: 0, start: 0, total: "0" } }))).toMatchObject({ total: 0, itemCount: 0, jobs: [] });
  });

  it("공고 ID가 없으면 링크의 해시를 ID로 쓴다", () => {
    const body = JSON.stringify({
      jobs: { count: 1, total: "1", job: [{ url: "https://www.saramin.co.kr/a", active: 1, position: { title: "신입 보육교사" } }] },
    });
    expect(parseSaraminResponse(body).jobs[0].sourceId).toMatch(/^[0-9a-f]{20}$/);
  });

  it("오류 응답({ code, message })은 코드와 메시지를 담은 오류로 던진다", () => {
    const error = (() => {
      try {
        parseSaraminResponse(saraminQuotaErrorBody);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(SaraminApiError);
    expect(error).toMatchObject({ code: 4 });
    expect((error as Error).message).toContain("일일 최대 요청");
  });

  it("JSON이 아니거나 예상 밖 모양이면 오류로 던진다", () => {
    expect(() => parseSaraminResponse("<html>점검 중</html>")).toThrow(SaraminApiError);
    expect(() => parseSaraminResponse("{}")).toThrow(SaraminApiError);
    expect(() => parseSaraminResponse("")).toThrow(SaraminApiError);
  });
});

describe("buildSaraminUrl", () => {
  it("필수 파라미터를 채우고 공백은 %20으로 인코딩한다", () => {
    const url = buildSaraminUrl({ accessKey: "KEY", keywords: "어린이집 보육교사", start: 2, count: 100, locCd: "101000", directHireOnly: true });
    expect(url.startsWith(`${SARAMIN_SEARCH_URL}?`)).toBe(true);
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      "access-key": "KEY",
      keywords: "어린이집 보육교사",
      start: "2",
      count: "100",
      loc_cd: "101000",
      sr: "directhire",
    });
    expect(url).toContain(`keywords=${encodeURIComponent("어린이집 보육교사")}`);
    expect(url).not.toContain("+");
  });

  it("선택 조건은 생략할 수 있다", () => {
    const keys = [...new URL(buildSaraminUrl({ accessKey: "KEY", keywords: "보육교사", start: 0, count: 10 })).searchParams.keys()];
    expect(keys.sort()).toEqual(["access-key", "count", "keywords", "start"]);
  });
});

/** 사람인 검색 응답을 흉내 낸다. 공고마다 서로 다른 ID를 만든다 */
function posting(id: string): object {
  return {
    url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`,
    active: 1,
    id,
    company: { detail: { name: `${id} 어린이집` } },
    position: { title: `${id} 담임교사 신입`, "experience-level": { code: 1, name: "신입" } },
    "close-type": { code: "3", name: "상시" },
  };
}
function body(total: number, ids: string[]): string {
  return JSON.stringify({ jobs: { count: ids.length, start: 0, total: String(total), job: ids.map(posting) } });
}
function fakeHttp(handler: (url: URL) => string | Error) {
  const get = vi.fn(async (url: string, _init?: { headers?: Record<string, string> }) => {
    const result = handler(new URL(url));
    if (result instanceof Error) throw result;
    return { status: 200, body: result, headers: new Headers(), attempts: 1 };
  });
  return { http: { get } satisfies HttpClient, get };
}
const requested = (get: ReturnType<typeof fakeHttp>["get"]) => get.mock.calls.map(([url]) => new URL(url).searchParams);

describe("createSaraminCollector", () => {
  const base = { getAccessKey: () => "KEY", count: 2 } as const;

  it("검색어마다 요청하고, JSON 응답과 직접 채용 공고만 요청한다", async () => {
    const { http, get } = fakeHttp(() => body(1, ["A"]));
    await createSaraminCollector({ ...base, http, keywords: ["보육교사", "담임교사"] }).fetchJobs();
    expect(requested(get).map((q) => q.get("keywords"))).toEqual(["보육교사", "담임교사"]);
    expect(requested(get).every((q) => q.get("access-key") === "KEY" && q.get("sr") === "directhire")).toBe(true);
    expect(get.mock.calls[0][1]?.headers).toMatchObject({ Accept: "application/json" });
  });

  it("쪽 크기를 일정하게 두고 start를 0부터 올려 가며, 총 건수에 닿으면 멈춘다", async () => {
    const pages: Record<string, string[]> = { "0": ["A", "B"], "1": ["C", "D"], "2": ["E"] };
    const { http, get } = fakeHttp((url) => body(5, pages[url.searchParams.get("start") ?? ""] ?? []));
    const result = await createSaraminCollector({ ...base, http, keywords: ["보육교사"] }).fetchJobs();
    expect(result.jobs.map((job) => job.sourceId)).toEqual(["A", "B", "C", "D", "E"]);
    expect(result.complete).toBe(true);
    expect(requested(get).map((q) => [q.get("start"), q.get("count")])).toEqual([
      ["0", "2"],
      ["1", "2"],
      ["2", "2"],
    ]);
  });

  it("여러 검색어에서 같은 공고가 나오면 하나로 합친다", async () => {
    const { http } = fakeHttp(() => body(2, ["A", "B"]));
    const result = await createSaraminCollector({ ...base, http, keywords: ["보육교사", "담임교사"] }).fetchJobs();
    expect(result.jobs.map((job) => job.sourceId)).toEqual(["A", "B"]);
  });

  it("하루 공고 예산을 넘기지 않는다: 예산이 모자라면 멈추고 일부만 가져온 것으로 표시한다", async () => {
    let n = 0;
    const { http, get } = fakeHttp(() => body(1000, [`P${n++}`, `P${n++}`]));
    const result = await createSaraminCollector({ ...base, http, keywords: ["보육교사"], dailyPostingBudget: 5 }).fetchJobs();
    // 쪽 크기 2, 예산 5: 2건씩 두 번(4건) 받고 남은 예산 1이 쪽 크기보다 작아 멈춘다
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.jobs).toHaveLength(4);
    expect(result.complete).toBe(false);
  });

  it("한도 초과(코드 4)를 만나도 이미 받은 공고가 있으면 그것을 돌려주되 일부만 가져온 것으로 표시한다", async () => {
    let calls = 0;
    const { http } = fakeHttp(() => (++calls === 1 ? body(10, ["A", "B"]) : saraminQuotaErrorBody));
    const result = await createSaraminCollector({ ...base, http, keywords: ["보육교사"] }).fetchJobs();
    expect(result.jobs.map((job) => job.sourceId)).toEqual(["A", "B"]);
    expect(result.complete).toBe(false);
  });

  it("처음부터 한도 초과면 오류로 던진다", async () => {
    const { http } = fakeHttp(() => saraminQuotaErrorBody);
    await expect(createSaraminCollector({ ...base, http, keywords: ["보육교사"] }).fetchJobs()).rejects.toMatchObject({ code: 4 });
  });

  it("HTTP 오류 본문에 담긴 한도 초과 코드도 읽는다 (4xx로 오는 경우)", async () => {
    let calls = 0;
    const { http } = fakeHttp(() => (++calls === 1 ? body(10, ["A", "B"]) : new HttpError("HTTP 403", 403, "https://x", 1, saraminQuotaErrorBody)));
    const result = await createSaraminCollector({ ...base, http, keywords: ["보육교사"] }).fetchJobs();
    expect(result.complete).toBe(false);
    expect(result.jobs).toHaveLength(2);
  });

  it("다른 HTTP 오류는 그대로 던진다", async () => {
    const { http } = fakeHttp(() => new HttpError("HTTP 500", 500, "https://x", 4));
    await expect(createSaraminCollector({ ...base, http, keywords: ["보육교사"] }).fetchJobs()).rejects.toBeInstanceOf(HttpError);
  });

  it("다음 쪽에 새 공고가 없으면 멈추고 일부만 가져온 것으로 표시한다", async () => {
    const { http, get } = fakeHttp(() => body(10, ["A", "B"]));
    const result = await createSaraminCollector({ ...base, http, keywords: ["보육교사"] }).fetchJobs();
    expect(result.jobs).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("지역 코드를 주면 코드마다 따로 요청한다", async () => {
    const { http, get } = fakeHttp(() => body(0, []));
    await createSaraminCollector({ ...base, http, keywords: ["보육교사"], locCodes: ["101000", "102000"] }).fetchJobs();
    expect(requested(get).map((q) => q.get("loc_cd"))).toEqual(["101000", "102000"]);
  });

  it("access-key가 없으면 요청하지 않고 안내와 함께 오류를 던진다", async () => {
    const { http, get } = fakeHttp(() => body(0, []));
    await expect(createSaraminCollector({ getAccessKey: () => undefined, http }).fetchJobs()).rejects.toThrow(/SARAMIN_API_KEY/);
    expect(get).not.toHaveBeenCalled();
  });

  it("범용 채용 소스라서 어린이집 맥락 검사를 요구한다", () => {
    expect(createSaraminCollector({ ...base, http: fakeHttp(() => body(0, [])).http })).toMatchObject({
      source: "saramin",
      isWorkplace: false,
      needsChildcareContext: true,
    });
  });
});
