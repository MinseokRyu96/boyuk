import { kstDate } from "../time";
import { SARAMIN_DAILY_POSTING_BUDGET, SARAMIN_REGION_CODES, SEARCH_KEYWORDS } from "./config";
import { HttpError, type HttpClient } from "./http";
import { idFromUrl } from "./ids";
import { normalizeRegion } from "./region";
import type { CollectResult, Collector, RawJob } from "./types";
import { safeHttpUrl } from "./url";

/*
 * 사람인 채용공고 검색 API (공식 명세: oapi.saramin.co.kr/guide/job-search).
 *   GET https://oapi.saramin.co.kr/job-search  (access-key 필수, Accept: application/json)
 *   응답: jobs > count, start, total(문자열), job[]
 *   오류: { code, message }  (1 키 없음, 2 유효하지 않은 키, 3 잘못된 파라미터, 4 일일 한도 초과, 99 오류)
 *
 * 이용자 주의사항: 일 공고 호출 수는 최대 500건이다. 원문 링크의 추적 파라미터(utm_*)는 그대로 둔다.
 */

export const SARAMIN_SEARCH_URL = "https://oapi.saramin.co.kr/job-search";
/** 한 번에 받을 수 있는 최대 건수 (명세) */
const MAX_COUNT = 110;
const QUOTA_EXCEEDED = 4;

export class SaraminApiError extends Error {
  constructor(
    /** 사람인이 준 오류 코드. 응답 형식이 아예 다르면 null */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "SaraminApiError";
  }
}

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);
const dict = (value: unknown): Dict => (isDict(value) ? value : {});

/** 문자열이나 숫자를 비어 있지 않은 문자열로. 그 외는 undefined */
function str(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toInt(value: unknown): number | undefined {
  const n = Number(str(value));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** experience-level 코드: 0 경력무관, 1 신입, 2 경력, 3 신입/경력 */
function careerHintFromCode(code: unknown): RawJob["careerHint"] {
  switch (toInt(code)) {
    case 0:
    case 3:
      return "any";
    case 1:
      return "new";
    case 2:
      return "experienced";
    default:
      return undefined;
  }
}

/** 접수 마감일(close-type 1)일 때만 마감일로 쓴다. 상시(3)·채용시(2)·수시(4)는 마감일이 없다 */
function deadlineOf(item: Dict): string | undefined {
  const closeType = str(dict(item["close-type"]).code);
  if (closeType !== undefined && closeType !== "1") return undefined;
  const seconds = toInt(item["expiration-timestamp"]);
  return seconds && seconds > 0 ? kstDate(new Date(seconds * 1000)) : undefined;
}

function joinText(...parts: (string | undefined)[]): string | undefined {
  const joined = parts.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

function toRawJob(item: Dict): RawJob | undefined {
  // 이미 마감된 공고(active 0)는 보여주지 않는다
  if (toInt(item.active) === 0) return undefined;

  const position = dict(item.position);
  const title = str(position.title);
  const url = safeHttpUrl(str(item.url));
  if (!title || !url) return undefined;

  const company = dict(item.company);
  const level = dict(position["experience-level"]);
  return {
    sourceId: str(item.id) ?? idFromUrl(url),
    title,
    // JSON 예시는 company.detail.name, XML 명세 표는 company.name이라 둘 다 받는다
    orgName: str(dict(company.detail).name) ?? str(company.name),
    region: normalizeRegion(str(dict(position.location).name)),
    deadline: deadlineOf(item),
    url,
    rawText: joinText(str(level.name), str(dict(position["job-code"]).name)),
    contextText: joinText(str(dict(position.industry).name), str(dict(position["job-mid-code"]).name)),
    careerHint: careerHintFromCode(level.code),
  };
}

export type SaraminPage = {
  total: number;
  /** 응답에 들어 있던 공고 수 (제목·링크가 없어 jobs에서 빠진 것도 센다) */
  itemCount: number;
  jobs: RawJob[];
};

/** 응답 본문 앞부분 (오류 메시지용) */
function snippet(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** 검색 응답 JSON을 공통 형식으로 바꾼다. 오류 응답({ code, message })은 SaraminApiError */
export function parseSaraminResponse(body: string): SaraminPage {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new SaraminApiError(null, `응답을 JSON으로 읽지 못했어요: ${snippet(body)}`);
  }
  if (!isDict(doc)) throw new SaraminApiError(null, `예상한 jobs가 없어요: ${snippet(body)}`);

  if (!isDict(doc.jobs)) {
    if ("code" in doc && "message" in doc) {
      const code = toInt(doc.code) ?? null;
      throw new SaraminApiError(code, `사람인 API 오류(코드 ${code ?? "?"}): ${str(doc.message) ?? ""}`);
    }
    throw new SaraminApiError(null, `예상한 jobs가 없어요: ${snippet(body)}`);
  }

  const jobs = doc.jobs;
  // 공고가 하나뿐이면 배열 대신 객체로 오는 변환기가 있어 둘 다 받는다
  const items = (Array.isArray(jobs.job) ? jobs.job : isDict(jobs.job) ? [jobs.job] : []).filter(isDict);
  return {
    total: toInt(jobs.total) ?? 0,
    itemCount: items.length,
    jobs: items.flatMap((item) => toRawJob(item) ?? []),
  };
}

export type SaraminQuery = {
  accessKey: string;
  keywords: string;
  /** 0부터 시작하는 쪽 번호 */
  start: number;
  count: number;
  locCd?: string;
  /** 헤드헌팅·파견업체 공고를 뺀다 */
  directHireOnly?: boolean;
  baseUrl?: string;
};

/** 요청 주소를 만든다. 공백은 +가 아니라 %20으로 인코딩한다 */
export function buildSaraminUrl(query: SaraminQuery): string {
  const params: [string, string | number | undefined][] = [
    ["access-key", query.accessKey],
    ["keywords", query.keywords],
    ["start", query.start],
    ["count", query.count],
    ["loc_cd", query.locCd],
    ["sr", query.directHireOnly ? "directhire" : undefined],
  ];
  const queryString = params
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${query.baseUrl ?? SARAMIN_SEARCH_URL}?${queryString}`;
}

export type SaraminCollectorOptions = {
  /** access-key는 호출할 때 읽는다 (환경변수 SARAMIN_API_KEY) */
  getAccessKey: () => string | undefined;
  http: HttpClient;
  keywords?: string[];
  /** 비우면 전국 */
  locCodes?: string[];
  /** 한 쪽 크기. 최대 110 */
  count?: number;
  /** 하루에 가져올 공고 수 상한. 사람인 일일 한도(500건)보다 작게 둔다 */
  dailyPostingBudget?: number;
  maxPagesPerQuery?: number;
  /** 헤드헌팅·파견 제외. 기본 true */
  directHireOnly?: boolean;
};

/** 오류 응답이 HTTP 오류(4xx)로 올 때 본문의 { code, message }를 읽어 SaraminApiError로 바꾼다 */
function apiErrorFromBody(body: string): SaraminApiError | undefined {
  try {
    parseSaraminResponse(body);
  } catch (error) {
    return error instanceof SaraminApiError && error.code !== null ? error : undefined;
  }
  return undefined;
}

export function createSaraminCollector(options: SaraminCollectorOptions): Collector {
  const {
    getAccessKey,
    http,
    keywords = SEARCH_KEYWORDS,
    locCodes = SARAMIN_REGION_CODES,
    count = 100,
    dailyPostingBudget = SARAMIN_DAILY_POSTING_BUDGET,
    maxPagesPerQuery = 5,
    directHireOnly = true,
  } = options;
  // start는 "쪽 번호"라서 쪽 크기를 중간에 바꾸면 위치가 어긋난다. 처음부터 끝까지 같은 크기를 쓴다
  const pageSize = Math.min(count, MAX_COUNT);
  const locs: (string | undefined)[] = locCodes.length > 0 ? locCodes : [undefined];

  async function request(url: string): Promise<string> {
    try {
      return (await http.get(url, { headers: { Accept: "application/json" } })).body;
    } catch (error) {
      if (error instanceof HttpError && error.body) {
        const apiError = apiErrorFromBody(error.body);
        if (apiError) throw apiError;
      }
      throw error;
    }
  }

  return {
    source: "saramin",
    isWorkplace: false,
    needsChildcareContext: true,

    async fetchJobs(): Promise<CollectResult> {
      const accessKey = getAccessKey();
      if (!accessKey) {
        throw new Error("SARAMIN_API_KEY 환경변수가 없어요. 사람인 오픈API에서 access-key를 발급받아 넣어 주세요.");
      }

      const found = new Map<string, RawJob>();
      let complete = true;
      let budget = dailyPostingBudget;

      try {
        search: for (const keyword of keywords) {
          for (const locCd of locs) {
            let reachedEnd = false;
            for (let page = 0; page < maxPagesPerQuery; page++) {
              // 하루 공고 예산이 한 쪽을 받기에 모자라면 여기서 멈춘다
              if (budget < pageSize) {
                complete = false;
                break search;
              }
              const url = buildSaraminUrl({ accessKey, keywords: keyword, start: page, count: pageSize, locCd, directHireOnly });
              const result = parseSaraminResponse(await request(url));
              budget -= result.itemCount;

              let added = 0;
              for (const job of result.jobs) {
                if (found.has(job.sourceId)) continue;
                found.set(job.sourceId, job);
                added++;
              }

              if (result.itemCount < pageSize || (page + 1) * pageSize >= result.total) {
                reachedEnd = true;
                break;
              }
              // 다음 쪽을 불러도 새 공고가 없다면 더 가도 소용없다
              if (added === 0) break;
            }
            if (!reachedEnd) complete = false;
          }
        }
      } catch (error) {
        // 일일 한도에 닿았어도 이미 받은 공고는 쓴다. 단, 일부만 가져온 것이라 표시한다
        if (error instanceof SaraminApiError && error.code === QUOTA_EXCEEDED && found.size > 0) {
          return { jobs: [...found.values()], complete: false };
        }
        throw error;
      }

      return { jobs: [...found.values()], complete };
    },
  };
}
