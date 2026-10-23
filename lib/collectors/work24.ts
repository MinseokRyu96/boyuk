import { XMLParser } from "fast-xml-parser";
import { SEARCH_KEYWORDS, WORK24_REGION_CODES } from "./config";
import { parseLooseDate } from "./dates";
import type { HttpClient } from "./http";
import { idFromUrl } from "./ids";
import { normalizeRegion } from "./region";
import type { CollectResult, Collector, RawJob } from "./types";
import { safeHttpUrl } from "./url";

/*
 * 고용24 OPEN-API 채용정보 목록 (공식 명세: 서비스 소개 및 신청 > 채용정보 목록).
 * 응답은 XML(UTF-8)이다. 출력 태그: wantedRoot > total, startPage, display, wanted[].
 *
 * 명세에 값의 예시가 없는 부분은 넓게 받아들인다. 키를 발급받아 실제 응답을 받으면 아래를 확인한다:
 *   1) regDt/closeDt 날짜 형식과 "채용시까지" 같은 문구 (parseLooseDate가 흔한 표기를 모두 읽는다)
 *   2) career 값의 표기 (careerHintFromText)
 *   3) region 값의 표기 (normalizeRegion, 없으면 basicAddr로 보완)
 *   4) startPage가 쪽 번호인지 시작 위치인지 (어느 쪽이든 동작하도록 새 공고가 없으면 멈춘다)
 *
 * 확인된 오류 응답: HTTP 200으로 <GO24><error>메시지</error></GO24>가 온다 (실제 호출로 확인, __fixtures__/work24-error.xml).
 * 인증키가 이 서비스로 승인되지 않았거나 틀리면 "신청하신 OpenApi 서비스가 존재하지 않습니다"가 온다.
 * 이때 서버는 틀린 키와 승인 안 된 키를 구분하지 않는다.
 */

export const WORK24_LIST_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do";
const WORK24_ORIGIN = "https://www.work24.go.kr";

export class Work24ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Work24ApiError";
  }
}

/** N: 신입, Z: 경력 무관 (E: 경력은 신입·담임 조건과 맞지 않아 요청하지 않는다) */
export type Work24Career = "N" | "Z";

const parser = new XMLParser({
  ignoreAttributes: true,
  // 구인인증번호처럼 숫자로 읽히면 안 되는 값이 있어 모두 문자열로 둔다
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "wanted",
});

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toInt(value: unknown): number | undefined {
  const n = Number(text(value));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function careerHintFromText(career: string | undefined): RawJob["careerHint"] {
  if (!career) return undefined;
  if (/관계\s*없|무관|불문/.test(career)) return "any";
  const newbie = /신입/.test(career);
  const experienced = /경력/.test(career);
  if (newbie && experienced) return "any";
  if (newbie) return "new";
  if (experienced) return "experienced";
  return undefined;
}

function toRawJob(item: Dict): RawJob | undefined {
  const title = text(item.title);
  const url = safeHttpUrl(text(item.wantedInfoUrl), WORK24_ORIGIN);
  // 제목이나 원문 링크가 없으면 보여줄 수 없고, 링크가 http(s)가 아니면 저장하지 않는다
  if (!title || !url) return undefined;

  const career = text(item.career);
  return {
    sourceId: text(item.wantedAuthNo) ?? idFromUrl(url),
    title,
    orgName: text(item.company),
    region: normalizeRegion(text(item.region)) ?? normalizeRegion(text(item.basicAddr)),
    deadline: parseLooseDate(text(item.closeDt)),
    url,
    rawText: career,
    contextText: text(item.indTpNm),
    careerHint: careerHintFromText(career),
  };
}

export type Work24Page = {
  total: number;
  startPage?: number;
  display?: number;
  /** 응답에 들어 있던 wanted 항목 수. 제목·링크가 없어 jobs에서 빠진 것도 센다 (쪽 끝 판단용) */
  itemCount: number;
  jobs: RawJob[];
};

/** 목록 응답 XML을 공통 형식으로 바꾼다. wantedRoot가 없는 응답은 Work24ApiError */
export function parseWork24List(xml: string): Work24Page {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Work24ApiError(`응답을 XML로 읽지 못했어요: ${snippet(xml)}`);
  }
  // 고용24의 오류 응답: <GO24><error>메시지</error></GO24>
  const serverError = isDict(doc) && isDict(doc.GO24) ? text(doc.GO24.error) : undefined;
  if (serverError) throw new Work24ApiError(explainServerError(serverError));

  if (!isDict(doc) || !("wantedRoot" in doc)) {
    const roots = isDict(doc) ? Object.keys(doc).join(", ") : "";
    throw new Work24ApiError(`예상한 wantedRoot가 없어요 (최상위: ${roots || "없음"}): ${snippet(xml)}`);
  }

  // 결과가 없으면 <wantedRoot/>처럼 내용이 빈 문자열로 읽힌다
  const root = isDict(doc.wantedRoot) ? doc.wantedRoot : {};
  const items = Array.isArray(root.wanted) ? root.wanted.filter(isDict) : [];
  return {
    total: toInt(root.total) ?? 0,
    startPage: toInt(root.startPage),
    display: toInt(root.display),
    itemCount: items.length,
    jobs: items.flatMap((item) => toRawJob(item) ?? []),
  };
}

/** 서버가 준 오류 문구에, 알려진 원인이 있으면 무엇을 확인할지 덧붙인다 */
function explainServerError(message: string): string {
  if (/개인회원/.test(message)) {
    return (
      `고용24 오류: ${message} 이 OPEN-API는 기업회원 전용이라서, 개인회원 계정에서 발급받은 인증키로는 쓸 수 없어요. ` +
      "기업회원으로 가입한 계정에서 채용정보 API 인증키를 발급받아 주세요."
    );
  }
  if (/서비스가 존재하지 않/.test(message)) {
    return (
      `고용24 오류: ${message}. 이 인증키가 '채용정보' API로 승인되지 않았거나 아직 반영되지 않았거나 키가 틀렸을 수 있어요. ` +
      "고용24 > OPEN-API > 신청현황에서 서비스 이름과 승인 상태를 확인해 주세요."
    );
  }
  return `고용24 오류: ${message}`;
}

/** 오류 메시지에 넣을 본문 앞부분 (공백을 줄이고 길이를 자른다) */
function snippet(body: string): string {
  return body.replace(/<\?xml[^>]*\?>/, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

export type Work24Query = {
  authKey: string;
  startPage: number;
  display: number;
  keyword?: string;
  career?: Work24Career;
  region?: string;
  baseUrl?: string;
};

/** 요청 주소를 만든다. 공백은 +가 아니라 %20으로 인코딩한다 */
export function buildWork24Url(query: Work24Query): string {
  const params: [string, string | number | undefined][] = [
    ["authKey", query.authKey],
    ["callTp", "L"],
    ["returnType", "XML"],
    ["startPage", query.startPage],
    ["display", query.display],
    ["keyword", query.keyword],
    ["career", query.career],
    ["region", query.region],
  ];
  const queryString = params
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${query.baseUrl ?? WORK24_LIST_URL}?${queryString}`;
}

export type Work24CollectorOptions = {
  /** 인증키는 호출할 때 읽는다 (환경변수 WORK24_API_KEY) */
  getAuthKey: () => string | undefined;
  http: HttpClient;
  keywords?: string[];
  careers?: Work24Career[];
  /** 비우면 전국 */
  regionCodes?: string[];
  /** 한 번에 받는 건수. 명세상 최대 100 */
  display?: number;
  /** 검색 조건 하나당 최대 쪽 수. 명세상 startPage 최대 1000 */
  maxPagesPerQuery?: number;
};

const HINT_BY_CAREER: Record<Work24Career, RawJob["careerHint"]> = { N: "new", Z: "any" };

export function createWork24Collector(options: Work24CollectorOptions): Collector {
  const {
    getAuthKey,
    http,
    keywords = SEARCH_KEYWORDS,
    careers = ["N", "Z"],
    regionCodes = WORK24_REGION_CODES,
    display = 100,
    maxPagesPerQuery = 10,
  } = options;
  const regions: (string | undefined)[] = regionCodes.length > 0 ? regionCodes : [undefined];

  return {
    source: "work24",
    isWorkplace: false,
    needsChildcareContext: true,

    async fetchJobs(): Promise<CollectResult> {
      const authKey = getAuthKey();
      if (!authKey) {
        throw new Error("WORK24_API_KEY 환경변수가 없어요. 고용24 OPEN-API에서 인증키를 발급받아 넣어 주세요.");
      }

      const found = new Map<string, RawJob>();
      let complete = true;

      for (const keyword of keywords) {
        for (const career of careers) {
          for (const region of regions) {
            let reachedEnd = false;
            for (let page = 1; page <= maxPagesPerQuery; page++) {
              const response = await http.get(buildWork24Url({ authKey, startPage: page, display, keyword, career, region }));
              const result = parseWork24List(response.body);

              let added = 0;
              for (const job of result.jobs) {
                if (found.has(job.sourceId)) continue;
                // 응답에 경력 값이 없으면 요청한 경력 조건으로 구분을 채운다
                found.set(job.sourceId, { ...job, careerHint: job.careerHint ?? HINT_BY_CAREER[career] });
                added++;
              }

              // 마지막 쪽: 한 쪽을 다 못 채웠거나, 총 건수만큼 받았다
              if (result.itemCount < display || page * display >= result.total) {
                reachedEnd = true;
                break;
              }
              // 다음 쪽을 불러도 새 공고가 없다면(같은 쪽 반복 등) 더 가도 소용없다
              if (added === 0) break;
            }
            // 끝까지 가지 못했다(쪽 상한에 막혔거나 같은 쪽이 반복됨): 일부만 가져온 것이다
            if (!reachedEnd) complete = false;
          }
        }
      }

      return { jobs: [...found.values()], complete };
    },
  };
}
