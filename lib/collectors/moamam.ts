import { load } from "cheerio";
import { MOAMAM_MAX_PAGES } from "./config";
import { parseLooseDate } from "./dates";
import type { HttpClient } from "./http";
import { normalizeRegion } from "./region";
import { assertRobotsAllows } from "./robots";
import type { CollectResult, Collector, RawJob } from "./types";

/*
 * 모아맘보육재단 채용사이트 (https://recruit.moamom.com) 채용공고 목록. robots.txt는 전체 허용이다 (2026-10-23 확인).
 * 공고는 두 게시판에 나뉘어 있고 목록 모양은 같다.
 *   - 교직원채용 /recruitment/staff-list.php   (type=1) 어린이집별 교직원 공고
 *   - 정기채용   /recruitment/regular-list.php (type=2) "2027년도 모아맘보육재단 정기채용" 같은 교사 공고
 * 목록 한 줄에 제목("[지역] 제목"), 어린이집명, 경력 구분(신입·경력·무관), 고용 형태, 접수 기간, 상태가 모두 있어서
 * 상세 페이지는 읽지 않는다. GET ?offset=10 단위로 쪽을 넘긴다.
 *
 * 마감된 공고는 줄에 class="deadline"이 붙고 링크가 "#"이다. 저장하지 않는다.
 * 목록은 마감된 공고까지 합쳐 등록순 최신순이라, 한 쪽이 전부 마감이면 더 읽지 않고 멈춘다. 이때는 목록 전체를 보지
 * 못했으므로 complete: false이고, 사라진 공고 숨기기는 건너뛴다(마감일이 지나면 숨겨지는 규칙이 정리한다).
 */

const ORIGIN = "https://recruit.moamom.com";
/** 목록은 한 쪽에 10건이다 */
const PAGE_SIZE = 10;

export type MoamamBoard = {
  key: "staff" | "regular";
  /** 상세 주소의 type 값 */
  type: 1 | 2;
  listPath: string;
  viewPath: string;
  /** 신입·직무 판별용. 정기채용은 제목에 직무가 없어서 사이트가 메인에 붙인 분류("교사")를 쓴다 */
  rawText?: string;
};

export const MOAMAM_BOARDS: MoamamBoard[] = [
  { key: "staff", type: 1, listPath: "/recruitment/staff-list.php", viewPath: "/recruitment/staff-view.php" },
  { key: "regular", type: 2, listPath: "/recruitment/regular-list.php", viewPath: "/recruitment/regular-view.php", rawText: "교사 정기채용" },
];

export class MoamamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoamamError";
  }
}

function clean(value: string | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

const CAREER_HINT: Record<string, RawJob["careerHint"]> = { 신입: "new", 경력: "experienced", 무관: "any" };

export type MoamamPage = {
  /** 목록에 있던 줄의 수. 마감된 줄도 센다 (쪽 끝 판단용) */
  itemCount: number;
  /** 접수 중이고 링크가 있는 공고만 */
  jobs: RawJob[];
};

/** 목록 HTML을 공통 형식으로 바꾼다. 목록 영역을 찾지 못하면 MoamamError (사이트 개편을 조용히 0건으로 넘기지 않는다) */
export function parseMoamamList(html: string, board: MoamamBoard): MoamamPage {
  const $ = load(html);
  const list = $("div.list > ul").first();
  if (list.length === 0) {
    throw new MoamamError("모아맘 채용 목록 영역(div.list > ul)을 찾지 못했어요. 사이트 구조가 바뀌었는지 확인해 주세요.");
  }

  const jobs: RawJob[] = [];
  let itemCount = 0;
  list.children("li").each((_, row) => {
    itemCount++;
    const item = $(row);
    if (item.hasClass("deadline")) return;

    // 상세 주소에서 숫자 idx만 꺼내 우리가 주소를 다시 만든다 (사이트가 붙인 검색 파라미터는 버린다)
    const href = item.find("a").first().attr("href") ?? "";
    const idx = href.includes(board.viewPath) ? /[?&]idx=(\d+)/.exec(href)?.[1] : undefined;
    const title = clean(item.find(".tit").first().text());
    if (!idx || !title) return;

    // .detail의 세 칸: 어린이집명, 경력 구분(신입·경력·무관), 고용 형태(계약·정규)
    const [org, career] = item.find(".detail span").map((_i, span) => clean($(span).text())).get();
    const period = clean(item.find(".period").first().text());
    // 접수 기간 "2026-10-21~2026-10-27"의 끝 날짜가 마감일
    const deadline = parseLooseDate(period?.split("~")[1]);
    const province = /^\[([^\]]+)\]/.exec(title)?.[1];

    jobs.push({
      sourceId: `${board.type}-${idx}`,
      title,
      orgName: org,
      region: normalizeRegion(province),
      deadline,
      url: `${ORIGIN}${board.viewPath}?type=${board.type}&mode=view&idx=${idx}`,
      rawText: board.rawText,
      careerHint: career ? CAREER_HINT[career] : undefined,
    });
  });

  return { itemCount, jobs };
}

export function buildMoamamUrl(board: MoamamBoard, offset: number): string {
  return `${ORIGIN}${board.listPath}?offset=${offset}`;
}

export type MoamamCollectorOptions = {
  http: HttpClient;
  boards?: MoamamBoard[];
  /** 게시판 하나당 최대 쪽 수 */
  maxPages?: number;
};

export function createMoamamCollector(options: MoamamCollectorOptions): Collector {
  const { http, boards = MOAMAM_BOARDS, maxPages = MOAMAM_MAX_PAGES } = options;

  return {
    source: "moamam",
    isWorkplace: true,

    async fetchJobs(): Promise<CollectResult> {
      // 허용되지 않으면 목록 요청을 한 번도 보내지 않고 여기서 멈춘다
      await assertRobotsAllows(http, buildMoamamUrl(boards[0], 0));

      const found = new Map<string, RawJob>();
      let complete = true;

      for (const board of boards) {
        let reachedEnd = false;
        for (let page = 0; page < maxPages; page++) {
          const response = await http.get(buildMoamamUrl(board, page * PAGE_SIZE));
          const result = parseMoamamList(response.body, board);

          for (const job of result.jobs) found.set(job.sourceId, job);

          // 마지막 쪽: 한 쪽을 다 못 채웠다
          if (result.itemCount < PAGE_SIZE) {
            reachedEnd = true;
            break;
          }
          // 이 쪽이 전부 마감이면 더 오래된 쪽도 마감일 것이므로 멈춘다
          if (result.jobs.length === 0) break;
        }
        // 끝까지 가지 않고 멈췄다: 목록 일부만 읽은 것이다
        if (!reachedEnd) complete = false;
      }

      return { jobs: [...found.values()], complete };
    },
  };
}
