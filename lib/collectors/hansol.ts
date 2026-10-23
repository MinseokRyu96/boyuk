import { load } from "cheerio";
import { HANSOL_MAX_PAGES } from "./config";
import { parseLooseDate } from "./dates";
import { isTarget } from "../normalize";
import { HttpError, type HttpClient } from "./http";
import { inferRegion, normalizeRegion } from "./region";
import { assertRobotsAllows } from "./robots";
import { htmlToText } from "./text";
import { orgNameFromTitle } from "./title";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 한솔어린이보육재단 채용사이트 > 채용공고 > 교사채용 (https://docu.hansolhope.or.kr/recruit/index.do).
 * robots.txt는 없다(404). 화면의 목록은 iframe으로 /recruit/recruit.do를 불러오는 것이라 그 주소를 직접 읽는다.
 * 사이트 폼은 POST지만 같은 값을 GET으로 보내도 똑같이 동작한다 (2026-10-23 확인):
 *   flg=list&mCurrent=2&sCurrent=1 (교사채용), pageNum=쪽 번호, listNum=10, STTUS=001 ("접수중 보기" 체크박스)
 * 접수 중인 공고만 받으면 마흔 건 남짓이라 네다섯 쪽이면 끝나서, 목록 전체를 본 것(complete: true)으로 처리한다.
 *
 * 목록 한 줄에는 구분(수시·정기), 제목, 접수 기간, 진행 상태뿐이다. 어린이집 이름은 제목에서 "…어린이집"까지를 떼어 쓰고,
 * 경력 구분은 목록에 없다. 지역도 목록에 없어서, 제목에서 서울을 읽지 못한 공고 중 신입·담임 판별을 통과한 것만
 * 상세 페이지를 열어 본문의 "근무지 : 경북 포항" 한 줄에서 지역을 읽는다 (서울 공고만 보여 주기 때문이다).
 * 상세에서는 근무지 외에는 읽지 않고, 담당자 연락처 같은 개인정보는 가져오지 않는다.
 * 원문 링크는 사이트 바깥 틀(index.do)에 상세를 넣어 보여 주는 GET 주소다.
 */

const ORIGIN = "https://docu.hansolhope.or.kr";
export const HANSOL_LIST_URL = `${ORIGIN}/recruit/recruit.do`;
/** 한 쪽에 10건 (listNum) */
const PAGE_SIZE = 10;

export class HansolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HansolError";
  }
}

function clean(value: string | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

/** 지원 방법을 알리는 공지 줄("[필독] … 안내 및 유의사항")은 채용 공고가 아니다 */
const NOTICE_ONLY = /\[필독\]|유의사항/;

/** 제목의 대괄호 중 시·도로 읽히는 첫 값을 지역으로 쓴다 ("[전국]"은 지역이 아니라서 건너뛴다) */
function regionFromTitle(title: string): string | undefined {
  for (const [, inside] of title.matchAll(/\[([^\]]*)\]/g)) {
    const region = normalizeRegion(inside.trim());
    if (region) return region;
  }
  return undefined;
}

export type HansolPage = {
  /** 목록에 있던 공고 줄의 수. 마감된 줄도 센다 */
  itemCount: number;
  /** 현재 쪽보다 뒤에 쪽 이동 링크가 있는가 */
  hasNext: boolean;
  jobs: RawJob[];
};

/** 목록 HTML을 공통 형식으로 바꾼다. 목록 표를 찾지 못하면 HansolError (사이트 개편을 조용히 0건으로 넘기지 않는다) */
export function parseHansolList(html: string): HansolPage {
  const $ = load(html);
  const table = $("table.tblTypeA").first();
  if (table.length === 0) {
    throw new HansolError("한솔 채용 목록 표(table.tblTypeA)를 찾지 못했어요. 사이트 구조가 바뀌었는지 확인해 주세요.");
  }

  const jobs: RawJob[] = [];
  let itemCount = 0;
  table.find("tr").each((_, tr) => {
    const row = $(tr);
    // 공고 줄은 제목 링크가 href="javascript:fnView('공고번호', '상태코드')"이다. 머리 줄에는 없다
    const link = row.find("a").filter((_i, a) => ($(a).attr("href") ?? "").startsWith("javascript:fnView(")).first();
    const match = /fnView\('(\d+)',\s*'(\d+)'\s*\)/.exec(link.attr("href") ?? "");
    if (!match) return;
    itemCount++;

    const [, sn, statusCode] = match;
    // 상태코드 002는 접수 마감이다 (사이트도 이때 "입사지원 기간이 마감되었습니다"를 띄운다)
    if (statusCode === "002" || /마감/.test(row.find("img").attr("alt") ?? "")) return;
    const title = clean(link.text());
    if (!title || NOTICE_ONLY.test(title)) return;

    // 접수 기간 "2026-10-23 ~ 2026-11-06"의 끝 날짜가 마감일
    const period = row.children("td").filter((_i, td) => /\d{4}-\d{2}-\d{2}\s*~/.test($(td).text())).first().text();

    jobs.push({
      sourceId: sn,
      title,
      orgName: orgNameFromTitle(title),
      region: regionFromTitle(title) ?? inferRegion(title),
      deadline: parseLooseDate(period.split("~")[1]),
      url: `${ORIGIN}/recruit/index.do?flg=view&mCurrent=2&sCurrent=3&empmn_sn=${sn}`,
    });
  });

  const current = Number($(".page_num li.on strong").first().text());
  const hasNext = $(".page_num a")
    .toArray()
    .some((a) => {
      const target = Number(/gfnPageNaviClick\('(\d+)'\)/.exec($(a).attr("href") ?? "")?.[1]);
      return Number.isFinite(current) && target > current;
    });

  return { itemCount, hasNext, jobs };
}

/** 접수 중인 교사채용 공고 목록의 page쪽 주소 */
/** 공고 상세(iframe이 불러오는 화면) 주소 */
export function buildHansolDetailUrl(sn: string): string {
  return `${HANSOL_LIST_URL}?flg=view&mCurrent=2&sCurrent=3&empmn_sn=${sn}`;
}

/** 공고 상세 본문의 "근무지 : 경북 포항" 한 줄에서 지역을 읽는다. 없거나 알아볼 수 없으면 undefined */
export function parseHansolWorkplace(html: string): string | undefined {
  const value = /근무지\s*[:：]\s*([^\n\r]{1,40})/.exec(htmlToText(html))?.[1]?.trim();
  return value ? (normalizeRegion(value) ?? inferRegion(value)) : undefined;
}

/** 지역을 읽지 못하는 일시 오류(없는 페이지·서버 오류·연결 실패)는 지역 없음으로 두고, 접근 거부 같은 오류는 그대로 던진다 */
async function fetchWorkplaceRegion(http: HttpClient, sn: string): Promise<string | undefined> {
  try {
    return parseHansolWorkplace((await http.get(buildHansolDetailUrl(sn))).body);
  } catch (error) {
    if (error instanceof HttpError && (error.status === null || error.status === 404 || error.status >= 500)) return undefined;
    throw error;
  }
}

export function buildHansolUrl(page: number): string {
  return `${HANSOL_LIST_URL}?flg=list&mCurrent=2&sCurrent=1&empmn_sn=&pageNum=${page}&listNum=${PAGE_SIZE}&STTUS=001`;
}

export type HansolCollectorOptions = {
  http: HttpClient;
  /** 최대 쪽 수 */
  maxPages?: number;
};

export function createHansolCollector(options: HansolCollectorOptions): Collector {
  const { http, maxPages = HANSOL_MAX_PAGES } = options;

  return {
    source: "hansol",
    isWorkplace: true,

    async fetchJobs(): Promise<CollectResult> {
      // 허용되지 않으면 목록 요청을 한 번도 보내지 않고 여기서 멈춘다
      await assertRobotsAllows(http, buildHansolUrl(1));

      const found = new Map<string, RawJob>();
      let reachedEnd = false;
      for (let page = 1; page <= maxPages; page++) {
        const response = await http.get(buildHansolUrl(page));
        const result = parseHansolList(response.body);
        for (const job of result.jobs) found.set(job.sourceId, job);

        // 마지막 쪽: 뒤로 이어지는 쪽 링크가 없다. 줄이 하나도 없으면 더 가도 소용없다
        if (!result.hasNext || result.itemCount === 0) {
          reachedEnd = true;
          break;
        }
      }

      // 지역을 모르는 신입·담임 후보는 상세에서 근무지를 읽는다. 후보가 아닌 공고는 어차피 저장하지 않으므로 요청하지 않는다
      const jobs = [...found.values()];
      for (const job of jobs) {
        if (!job.region && isTarget(job)) job.region = await fetchWorkplaceRegion(http, job.sourceId);
      }

      // 쪽 상한에 막혔다면 목록 일부만 읽은 것이다
      return { jobs, complete: reachedEnd };
    },
  };
}
