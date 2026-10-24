import { load } from "cheerio";
import { SAMSUNG_MAX_PAGES } from "./config";
import { parseLooseDate } from "./dates";
import { isTarget } from "../normalize";
import { HttpError, type HttpClient } from "./http";
import { inferRegion } from "./region";
import { assertRobotsAllows } from "./robots";
import { htmlToText } from "./text";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 삼성복지재단 > 삼성어린이집 > 교직원 채용 (https://www.samsungwelfare.org/html/welfare/nursery/recruit.asp).
 * 목록 표의 열은 번호, 어린이집명, 직종, 서류접수기간, 진행사항, 작성일, 조회 순서다 (2026-10-23 확인).
 * 번호가 큰 순서(최신순)이고, 진행 중인 공고에는 어린이집명 옆에 진행중 아이콘(img.ico-ing)이 붙는다.
 * 표 위에 "진행중인 모집 공고 : 총 11건"이 있어서, 그만큼 읽으면 멈춘다. 쪽 이동(?page=N)과 상세(recruit_view.asp)는
 * 사이트 폼이 POST지만 GET으로도 같은 화면이 열린다.
 *
 * 목록에 제목 칸이 없어 직종("보육교사(27학년도 정규직 담임교사)")을 제목으로 쓰고, 어린이집명은 그대로 쓴다.
 * 지역은 목록에도 상세에도 없다. 어린이집명에서 서울을 읽지 못한 공고 중 신입·담임 판별을 통과한 것만 상세를 열어,
 * 연락처의 지역번호로 시·도를 정한다(02 서울, 031 경기, 032 인천 …. 어린이집 대표 전화라 믿을 만한 단서지만 추정이다).
 * 지역번호만 보고 전화번호·이메일 같은 연락처는 가져오지 않는다.
 *
 * 다른 출처는 서울 공고만 저장하지만, 삼성은 사용자 요청으로 "정규직 담임" 공고(직종에 정규직과 담임이 함께 있는 것,
 * 예: "보육교사(27학년도 정규직 담임교사)")는 서울 밖이어도 저장한다(keepOutsideRegion). 삼성어린이집은 대부분 경기·인천 사업장에 있다.
 *
 * robots.txt는 `User-agent: *` / `Disallow: /`로 전체 금지이고, 이용약관(/html/terms.asp)은 회원이 서비스에서 얻은 정보를
 * 사전 승낙 없이 서비스 이용 외의 목적으로 복제하거나 제3자에게 제공하는 것을 금지한다 (2026-10-23 확인).
 * 푸르니와 같은 이유로 사용자가 소수 지인용 비영리 서비스라는 판단으로 이 사이트의 robots.txt를 무시하기로 했다
 * (ignoreRobotsTxt: true, 켜는 곳은 index.ts). 요청은 목록 한두 쪽, 하루 한 번, 식별 가능한 User-Agent로 하고,
 * 기술적 차단(403 등)은 우회하지 않고 실패로 기록한다.
 */

const ORIGIN = "https://www.samsungwelfare.org";
export const SAMSUNG_LIST_URL = `${ORIGIN}/html/welfare/nursery/recruit.asp`;
export const SAMSUNG_VIEW_URL = `${ORIGIN}/html/welfare/nursery/recruit_view.asp`;

export class SamsungError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamsungError";
  }
}

function clean(value: string | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

export type SamsungPage = {
  /** 표 위의 "진행중인 모집 공고 : 총 N건". 읽지 못하면 undefined */
  openTotal?: number;
  /** 목록에 있던 공고 줄의 수. 진행이 끝난 줄도 센다 */
  itemCount: number;
  /** 쪽 이동 링크 중 현재 쪽보다 큰 번호가 있는가 */
  hasNext: boolean;
  /** 진행 중인 공고만 */
  jobs: RawJob[];
};

/** 목록 HTML을 공통 형식으로 바꾼다. 목록 표를 찾지 못하면 SamsungError (사이트 개편을 조용히 0건으로 넘기지 않는다) */
export function parseSamsungList(html: string): SamsungPage {
  const $ = load(html);
  const table = $("table.list-tb2").first();
  if (table.length === 0) {
    throw new SamsungError("삼성 채용 목록 표(table.list-tb2)를 찾지 못했어요. 사이트 구조가 바뀌었는지 확인해 주세요.");
  }

  const jobs: RawJob[] = [];
  let itemCount = 0;
  table.find("tbody tr").each((_, tr) => {
    const row = $(tr);
    const cells = row.children("td");
    // 상세로 가는 링크는 href="javascript:_view(공고번호, 쪽)"이다. 숫자만 받는다
    const link = cells.eq(1).find("a").first();
    const match = /_view\((\d+),\s*(\d+)\)/.exec(link.attr("href") ?? "");
    if (!match || cells.length < 7) return;
    itemCount++;

    // 진행 중인 줄에만 진행중 아이콘이 붙는다. 진행이 끝난 줄은 진행사항 칸에 글자(서류전형 완료 등)가 있다
    if (row.find("img.ico-ing").length === 0) return;

    const [, seq, page] = match;
    const orgName = clean(link.text());
    const duty = clean(cells.eq(2).text());
    const title = duty ?? orgName;
    if (!title) return;

    // 서류접수기간 "20261023 ~ 20261104"의 끝 날짜가 마감일
    const period = cells.eq(3).text();
    jobs.push({
      sourceId: seq,
      title,
      orgName,
      // 목록에 지역 칸이 없어서 어린이집명·직종에 "서울"이나 서울의 구 이름이 있을 때만 서울로 읽는다
      region: inferRegion(`${orgName ?? ""} ${duty ?? ""}`),
      deadline: parseLooseDate(period.split("~")[1]),
      url: `${SAMSUNG_VIEW_URL}?seq=${seq}&page=${page}&prc_seq=view`,
    });
  });

  const total = /진행중인 모집 공고\s*:\s*총\s*([\d,]+)\s*건/.exec($.root().text())?.[1];
  const current = Number($(".paging strong").first().text());
  const hasNext = $(".paging a")
    .toArray()
    .some((a) => {
      const target = Number(/_gotoPage2\(\s*goPage\s*,\s*(\d+)/.exec($(a).attr("href") ?? "")?.[1]);
      return Number.isFinite(current) && target > current;
    });

  return { openTotal: total ? Number(total.replace(/,/g, "")) : undefined, itemCount, hasNext, jobs };
}

/** 공고 상세 주소 (목록의 원문 링크와 같다) */
function detailUrl(seq: string): string {
  return `${SAMSUNG_VIEW_URL}?seq=${seq}&page=1&prc_seq=view`;
}

/** 유선전화 지역번호와 시·도(region.ts의 짧은 표기). 휴대전화(010)·인터넷전화(070)는 지역을 알 수 없어 넣지 않는다 */
const AREA_CODES: Record<string, string> = {
  "02": "서울",
  "031": "경기",
  "032": "인천",
  "033": "강원",
  "041": "충남",
  "042": "대전",
  "043": "충북",
  "044": "세종",
  "051": "부산",
  "052": "울산",
  "053": "대구",
  "054": "경북",
  "055": "경남",
  "061": "전남",
  "062": "광주",
  "063": "전북",
  "064": "제주",
};

/** 상세 본문의 "연락처" 전화번호의 지역번호로 시·도를 읽는다. 지역번호가 없거나 휴대전화면 undefined */
export function parseSamsungContactRegion(html: string): string | undefined {
  const phone = /연락처\s*[:：]?\s*\(?(0\d{1,2})\)?[-\s.]?\d{3,4}[-\s.]?\d{4}/.exec(htmlToText(html));
  return phone ? AREA_CODES[phone[1]] : undefined;
}

/** 서울 밖이어도 보여 줄 정규직 담임 공고인가. 직종(제목)에 "정규직"과 "담임"("비담임"은 빼고)이 함께 있어야 한다 */
export function isRegularHomeroom(job: RawJob): boolean {
  return /정규\s*직/.test(job.title) && /(?<!비\s*)담임/.test(job.title);
}

/** 지역을 읽지 못하는 일시 오류(없는 페이지·서버 오류·연결 실패)는 지역 없음으로 두고, 접근 거부 같은 오류는 그대로 던진다 */
async function fetchContactRegion(http: HttpClient, seq: string): Promise<string | undefined> {
  try {
    return parseSamsungContactRegion((await http.get(detailUrl(seq))).body);
  } catch (error) {
    if (error instanceof HttpError && (error.status === null || error.status === 404 || error.status >= 500)) return undefined;
    throw error;
  }
}

export function buildSamsungUrl(page: number): string {
  return `${SAMSUNG_LIST_URL}?page=${page}`;
}

export type SamsungCollectorOptions = {
  http: HttpClient;
  maxPages?: number;
  /**
   * true이면 robots.txt를 확인하지 않고 수집한다 (robots.txt 요청도 보내지 않는다).
   * 삼성복지재단의 robots.txt는 전체 금지라서, 기본값(false)이면 수집은 항상 CrawlNotAllowedError로 멈춘다.
   */
  ignoreRobotsTxt?: boolean;
};

export function createSamsungCollector(options: SamsungCollectorOptions): Collector {
  const { http, maxPages = SAMSUNG_MAX_PAGES, ignoreRobotsTxt = false } = options;

  return {
    source: "samsung",
    isWorkplace: true,
    keepOutsideRegion: isRegularHomeroom,

    async fetchJobs(): Promise<CollectResult> {
      if (!ignoreRobotsTxt) await assertRobotsAllows(http, buildSamsungUrl(1));

      const found = new Map<string, RawJob>();
      let complete = false;
      for (let page = 1; page <= maxPages; page++) {
        const response = await http.get(buildSamsungUrl(page));
        const result = parseSamsungList(response.body);
        for (const job of result.jobs) found.set(job.sourceId, job);

        // 표 위에 적힌 진행 중 공고 수만큼 읽었거나, 더 읽을 쪽이 없다: 진행 중인 공고를 빠짐없이 읽은 것이다
        const readAllOpen = result.openTotal !== undefined && found.size >= result.openTotal;
        if (readAllOpen || !result.hasNext || result.itemCount === 0) {
          complete = true;
          break;
        }
        // 진행 중인 공고가 하나도 없는 쪽부터는 이미 끝난 공고뿐이다. 그런데 총 건수만큼 못 읽었으니 일부만 읽은 것으로 본다
        if (result.jobs.length === 0) break;
      }

      // 지역을 모르는 신입·담임 후보는 상세의 연락처 지역번호로 시·도를 정한다. 후보가 아닌 공고는 어차피 저장하지 않으므로 요청하지 않는다
      const jobs = [...found.values()];
      for (const job of jobs) {
        if (!job.region && isTarget(job)) job.region = await fetchContactRegion(http, job.sourceId);
      }

      return { jobs, complete };
    },
  };
}
