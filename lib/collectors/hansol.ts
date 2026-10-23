import { load } from "cheerio";
import { HANSOL_MAX_PAGES } from "./config";
import { parseLooseDate } from "./dates";
import type { HttpClient } from "./http";
import { normalizeRegion } from "./region";
import { assertRobotsAllows } from "./robots";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 한솔어린이보육재단 채용사이트 > 채용공고 > 교사채용 (https://docu.hansolhope.or.kr/recruit/index.do).
 * robots.txt는 없다(404). 화면의 목록은 iframe으로 /recruit/recruit.do를 불러오는 것이라 그 주소를 직접 읽는다.
 * 사이트 폼은 POST지만 같은 값을 GET으로 보내도 똑같이 동작한다 (2026-10-23 확인):
 *   flg=list&mCurrent=2&sCurrent=1 (교사채용), pageNum=쪽 번호, listNum=10, STTUS=001 ("접수중 보기" 체크박스)
 * 접수 중인 공고만 받으면 마흔 건 남짓이라 네다섯 쪽이면 끝나서, 목록 전체를 본 것(complete: true)으로 처리한다.
 *
 * 목록 한 줄에는 구분(수시·정기), 제목, 접수 기간, 진행 상태뿐이다. 어린이집 이름은 제목에서 "…어린이집"까지를 떼어 쓰고,
 * 지역·경력 구분은 목록에 없다. 상세 페이지는 읽지 않는다 (요청이 늘고 얻는 정보가 적다).
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

/** 제목 앞머리의 "[정기] [전국]" 같은 대괄호 표시를 떼어 낸다 */
const BRACKETS = /\[[^\]]*\]/g;
/** 지원 방법을 알리는 공지 줄("[필독] … 안내 및 유의사항")은 채용 공고가 아니다 */
const NOTICE_ONLY = /\[필독\]|유의사항/;

/**
 * 제목에서 어린이집 이름을 꺼낸다: 대괄호와 앞의 연도를 뺀 맨 앞에서 첫 "…어린이집"까지.
 * 어린이집 이름이 없거나("2027년 보육교사 정기채용"), 채용 문구가 섞여 이름이 아닌 것 같으면 undefined.
 */
export function orgNameFromTitle(title: string): string | undefined {
  const text = title.replace(BRACKETS, " ").replace(/^\s*20\d{2}\s*(?:년도?)?\s+/, "");
  // 이름 뒤에는 공백이나 괄호가 온다 ("…어린이집(출산 및 육아휴직) 대체교사")
  const name = /^\s*(\S.*?어린이집)(?=[\s(（]|$)/.exec(text)?.[1];
  return name && !/채용|모집|공고/.test(name) ? name : undefined;
}

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
      region: regionFromTitle(title),
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

      // 쪽 상한에 막혔다면 목록 일부만 읽은 것이다
      return { jobs: [...found.values()], complete: reachedEnd };
    },
  };
}
