import { load } from "cheerio";
import { PURUNI_MAX_PAGES } from "./config";
import { parseLooseDate } from "./dates";
import type { HttpClient } from "./http";
import { inferRegion, normalizeRegion } from "./region";
import { assertRobotsAllows } from "./robots";
import { orgNameFromTitle } from "./title";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 푸르니보육지원재단 위탁 어린이집 교직원 채용시스템 > 채용공고 (https://recruit.puruni.com/recruit/notice).
 * 접수 중인 공고만 올라오는 작은 게시판이다 (2026-10-23에 두 건). GET ?page=쪽 번호로 쪽을 넘긴다.
 * 목록 한 줄에는 제목("[서울마포] 햇살가득어린이집 육아대체교사모집")과 접수 기간뿐이다.
 * 어린이집 이름은 제목에서 떼고, 지역은 대괄호가 시·도로 시작할 때만 쓴다. 상세 페이지는 읽지 않는다.
 * 원문 링크는 상세를 GET으로 여는 주소(/recruit/notice/view?page=&idx=)다.
 *
 * robots.txt는 `User-agent: *` / `Disallow: /`로 전체 금지다 (2026-10-23 확인). 이용약관(/recruit/use)에는 수집·복제를 막는
 * 문구가 없다. 그래서 기본값은 다른 크롤러와 같이 robots.txt를 따르고, 이 사이트만 사용자가 소수 지인용 비영리 서비스라는
 * 이유로 직접 무시하기로 했다 (ignoreRobotsTxt: true, 켜는 곳은 index.ts). 대신 요청은 목록 한두 쪽으로 줄이고 하루 한 번만
 * 하며, 식별 가능한 User-Agent를 그대로 쓴다. 사이트가 접근을 기술적으로 막으면(403 등) 우회하지 않고 수집을 실패로 기록한다.
 */

const ORIGIN = "https://recruit.puruni.com";
export const PURUNI_LIST_URL = `${ORIGIN}/recruit/notice`;
export const PURUNI_VIEW_URL = `${ORIGIN}/recruit/notice/view`;

export class PuruniError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PuruniError";
  }
}

function clean(value: string | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

/** "[서울마포]"처럼 시·도 뒤에 구가 붙어도 앞 두 글자(서울)로 시·도를 읽는다. "[서대문구]"처럼 시·도가 없으면 undefined */
function regionFromBracket(title: string): string | undefined {
  const inside = /^\s*\[([^\]]*)\]/.exec(title)?.[1]?.trim();
  if (!inside) return undefined;
  return normalizeRegion(inside) ?? normalizeRegion(inside.slice(0, 2));
}

export type PuruniPage = {
  /** 목록의 공고 줄 수 */
  itemCount: number;
  /** 쪽 이동 링크 중 현재 쪽보다 큰 번호가 있는가 */
  hasNext: boolean;
  jobs: RawJob[];
};

/** 목록 HTML을 공통 형식으로 바꾼다. 목록 표를 찾지 못하면 PuruniError (사이트 개편을 조용히 0건으로 넘기지 않는다) */
export function parsePuruniList(html: string): PuruniPage {
  const $ = load(html);
  const table = $("table.recruit-bbs").first();
  if (table.length === 0) {
    throw new PuruniError("푸르니 채용 목록 표(table.recruit-bbs)를 찾지 못했어요. 사이트 구조가 바뀌었는지 확인해 주세요.");
  }

  const jobs: RawJob[] = [];
  let itemCount = 0;
  table.find("tbody tr").each((_, tr) => {
    const row = $(tr);
    // 제목 링크는 onClick="pageView(쪽, 공고번호)"로 상세를 연다
    const link = row.find("a").first();
    const match = /pageView\((\d+),\s*(\d+)\)/.exec(link.attr("onclick") ?? "");
    if (!match) return;
    itemCount++;

    const [, page, idx] = match;
    const title = clean(link.text());
    if (!title) return;

    // 접수 기간 "2026-10-23 ~ 2026-10-31"의 끝 날짜가 마감일
    const period = row.children("td").last().text();
    jobs.push({
      sourceId: idx,
      title,
      orgName: orgNameFromTitle(title),
      region: regionFromBracket(title) ?? inferRegion(title),
      deadline: parseLooseDate(period.split("~")[1]),
      url: `${PURUNI_VIEW_URL}?page=${page}&idx=${idx}`,
    });
  });

  const current = Number($(".pager a.on").first().text());
  const hasNext = $(".pager a")
    .toArray()
    .some((a) => /^\d+$/.test($(a).text().trim()) && Number($(a).text()) > current);

  return { itemCount, hasNext, jobs };
}

export function buildPuruniUrl(page: number): string {
  return `${PURUNI_LIST_URL}?page=${page}`;
}

export type PuruniCollectorOptions = {
  http: HttpClient;
  maxPages?: number;
  /**
   * true이면 robots.txt를 확인하지 않고 수집한다 (robots.txt 요청도 보내지 않는다).
   * 푸르니의 robots.txt는 전체 금지라서, 기본값(false)이면 수집은 항상 CrawlNotAllowedError로 멈춘다.
   */
  ignoreRobotsTxt?: boolean;
};

export function createPuruniCollector(options: PuruniCollectorOptions): Collector {
  const { http, maxPages = PURUNI_MAX_PAGES, ignoreRobotsTxt = false } = options;

  return {
    source: "purunee",
    isWorkplace: true,

    async fetchJobs(): Promise<CollectResult> {
      if (!ignoreRobotsTxt) await assertRobotsAllows(http, buildPuruniUrl(1));

      const found = new Map<string, RawJob>();
      let reachedEnd = false;
      for (let page = 1; page <= maxPages; page++) {
        const response = await http.get(buildPuruniUrl(page));
        const result = parsePuruniList(response.body);
        for (const job of result.jobs) found.set(job.sourceId, job);

        // 마지막 쪽: 뒤로 이어지는 쪽 번호가 없다. 줄이 하나도 없으면 더 가도 소용없다
        if (!result.hasNext || result.itemCount === 0) {
          reachedEnd = true;
          break;
        }
      }

      return { jobs: [...found.values()], complete: reachedEnd };
    },
  };
}
