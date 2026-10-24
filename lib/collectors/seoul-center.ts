import { load } from "cheerio";
import { SEOUL_CENTER_JOB_CODES, SEOUL_CENTER_MAX_PAGES } from "./config";
import { parseLooseDate } from "./dates";
import type { HttpClient } from "./http";
import { normalizeRegion } from "./region";
import { assertRobotsAllows } from "./robots";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 서울특별시육아종합지원센터 > 어린이집 구인 목록 (https://seoul.childcare.go.kr/ccef/job/JobOfferSlPL.jsp).
 * 목록 표의 열은 번호, 유형, 제목, 어린이집명, 직종, 소재지, 마감일, 작성일, 조회 순서다 (2026-10-23 확인).
 * GET 주소에 검색 조건(endYn=N 구인중, schEmpGbCode=직종)과 offset(10건 단위)을 붙여 읽는다.
 *
 * 저장하는 것은 제목·어린이집명·지역·마감일·원문 링크뿐이다 (PRD 10장). 상세 페이지는 읽지 않는다.
 * 상세에는 담당자 이름·전화·이메일이 있어서 개인정보를 가져올 이유가 없고, 요청 수도 늘어난다.
 * 약관(제14조 ④)이 사전 승낙 없는 복제를 막고 있으므로 원문은 보여주지 않고 링크로만 보낸다.
 * robots.txt는 실행할 때마다 확인한다. 사이트가 나중에 막으면 수집이 멈춘다.
 */

const ORIGIN = "https://seoul.childcare.go.kr";
export const SEOUL_CENTER_LIST_URL = `${ORIGIN}/ccef/job/JobOfferSlPL.jsp`;
export const SEOUL_CENTER_DETAIL_URL = `${ORIGIN}/ccef/job/JobOfferSl.jsp`;

/** 서울센터 목록은 한 쪽에 10건이다 (limit 값을 따로 주지 않은 기본값) */
const PAGE_SIZE = 10;

export class SeoulCenterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoulCenterError";
  }
}

/** 공백을 한 칸으로 줄이고 앞뒤를 자른다. 비면 undefined */
function clean(value: string | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

export type SeoulCenterPage = {
  /** 검색 조건에 맞는 전체 건수 ("총 1463 건이 검색되었습니다") */
  total: number;
  /** 표에서 읽은 공고 행의 수. 제목이 없어 jobs에서 빠진 행도 센다 (쪽 끝 판단용) */
  itemCount: number;
  jobs: RawJob[];
};

/**
 * 목록 페이지 HTML을 공통 형식으로 바꾼다. 목록 표나 총 건수를 찾지 못하면 SeoulCenterError.
 * (사이트가 개편되면 조용히 0건이 되지 않고 수집 실패로 드러나게 한다)
 */
export function parseSeoulCenterList(html: string): SeoulCenterPage {
  const $ = load(html);
  const table = $(".com_list1 table").first();
  const totalMatch = /총\s*([\d,]+)\s*건/.exec($.root().text());
  if (table.length === 0 || !totalMatch) {
    throw new SeoulCenterError("서울센터 구인 목록의 표나 총 건수를 찾지 못했어요. 사이트 구조가 바뀌었는지 확인해 주세요.");
  }

  const jobs: RawJob[] = [];
  let itemCount = 0;
  table.find("tbody tr").each((_, row) => {
    const cells = $(row).children("td");
    if (cells.length < 8) return;

    const link = cells.eq(2).find("a").first();
    // 상세로 가는 주소는 onclick="fnGoBoardSl('2346194')"에 들어 있다. 숫자 ID만 받는다
    const id = /fnGoBoardSl\('(\d+)'\)/.exec(link.attr("onclick") ?? "")?.[1];
    if (!id) return;
    itemCount++;

    // 표에 보이는 글자는 길면 "..."로 잘려서, 전체 제목이 담긴 title 속성을 먼저 쓴다
    const title = clean(link.attr("title")) ?? clean(link.text());
    if (!title) return;
    // 유형 열: 국공립·사회복지법인·법인·단체등·민간·가정·직장·협동 (검색 폼의 schCrType)
    const facilityType = clean(cells.eq(1).text());

    jobs.push({
      sourceId: id,
      title,
      orgName: clean(cells.eq(3).text()),
      region: normalizeRegion(clean(cells.eq(5).text())),
      deadline: parseLooseDate(cells.eq(6).text()),
      url: `${SEOUL_CENTER_DETAIL_URL}?flag=Sl&JOSEQ=${id}`,
      // 신입·직무 판별용. 직종 열의 값(보육교사 등)
      rawText: clean(cells.eq(4).text()),
      facilityType,
      // 유형 열이 "직장"이면 직장어린이집 공고다
      isWorkplace: facilityType === "직장",
    });
  });

  return { total: Number(totalMatch[1].replace(/,/g, "")), itemCount, jobs };
}

export type SeoulCenterQuery = {
  /** 몇 번째 공고부터인지(0부터, 10건 단위) */
  offset: number;
  /** 직종 코드. 32는 보육교사 */
  jobCode?: string;
  baseUrl?: string;
};

/** 목록 요청 주소를 만든다. 구인 중(endYn=N)인 공고만 받는다 */
export function buildSeoulCenterUrl(query: SeoulCenterQuery): string {
  const params: [string, string | number | undefined][] = [
    ["flag", "SlPL"],
    ["offset", query.offset],
    ["endYn", "N"],
    ["schEmpGbCode", query.jobCode],
  ];
  const queryString = params
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${query.baseUrl ?? SEOUL_CENTER_LIST_URL}?${queryString}`;
}

export type SeoulCenterCollectorOptions = {
  http: HttpClient;
  jobCodes?: string[];
  /** 직종 코드 하나당 최대 쪽 수 */
  maxPages?: number;
};

export function createSeoulCenterCollector(options: SeoulCenterCollectorOptions): Collector {
  const { http, jobCodes = SEOUL_CENTER_JOB_CODES, maxPages = SEOUL_CENTER_MAX_PAGES } = options;

  return {
    source: "seoul_center",
    isWorkplace: false,

    async fetchJobs(): Promise<CollectResult> {
      // 허용되지 않으면 목록 요청을 한 번도 보내지 않고 여기서 멈춘다
      await assertRobotsAllows(http, buildSeoulCenterUrl({ offset: 0, jobCode: jobCodes[0] }));

      const found = new Map<string, RawJob>();
      let complete = true;

      for (const jobCode of jobCodes) {
        let reachedEnd = false;
        for (let page = 0; page < maxPages; page++) {
          const offset = page * PAGE_SIZE;
          const response = await http.get(buildSeoulCenterUrl({ offset, jobCode }));
          const result = parseSeoulCenterList(response.body);

          let added = 0;
          for (const job of result.jobs) {
            if (found.has(job.sourceId)) continue;
            found.set(job.sourceId, job);
            added++;
          }

          // 마지막 쪽: 한 쪽을 다 못 채웠거나 총 건수만큼 읽었다
          if (result.itemCount < PAGE_SIZE || offset + result.itemCount >= result.total) {
            reachedEnd = true;
            break;
          }
          // 새 공고가 하나도 없으면(같은 쪽이 반복되는 경우) 더 가도 소용없다
          if (added === 0) break;
        }
        // 쪽 상한에 막혔다: 목록 일부만 읽은 것이다
        if (!reachedEnd) complete = false;
      }

      return { jobs: [...found.values()], complete };
    },
  };
}
