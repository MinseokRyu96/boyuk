import { SOURCES } from "./sources";
import type { FeedRow } from "./types";

/*
 * Supabase가 연결되지 않았을 때 화면을 확인하기 위한 샘플 공고.
 * 어린이집 이름과 공고는 모두 가상이고, 링크도 실제 공고가 아니다.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Seed = {
  org: string | null;
  title: string;
  region: string;
  deadlineInDays: number | null;
  sources: (keyof typeof SOURCES)[];
  hoursAgo: number;
};

/** 화면의 여러 경우(NEW, 마감 임박, 상시, 어린이집명 없음, 긴 제목, 여러 출처)가 모두 보이도록 앞쪽에 모아 둔다 */
const FEATURED: Seed[] = [
  { org: "해오름어린이집", title: "[신입 가능] 만 1세반 담임교사 모집", region: "서울 강서구", deadlineInDays: 2, sources: ["work24", "seoul_center"], hoursAgo: 1 },
  { org: "푸르니 별빛어린이집", title: "보육교사 채용 (경력 무관, 직장어린이집)", region: "서울 마포구", deadlineInDays: 9, sources: ["purunee"], hoursAgo: 3 },
  { org: null, title: "담임교사 모집 — 신입 환영, 4대보험 및 처우개선비 지원", region: "서울 양천구", deadlineInDays: null, sources: ["saramin"], hoursAgo: 6 },
  { org: "한솔 꿈나무어린이집", title: "2027년 3월 입사 예정 만 3세반 담임교사 신입 및 경력 무관 공개 채용 안내 (자격증 취득 예정자 지원 가능)", region: "경기 성남시", deadlineInDays: 0, sources: ["hansol"], hoursAgo: 20 },
  { org: "모아맘 햇살어린이집", title: "만 2세반 담임교사 모집", region: "서울 송파구", deadlineInDays: 14, sources: ["moamam", "work24"], hoursAgo: 30 },
  { org: "삼성 드림어린이집", title: "보육교사 신입 채용", region: "경기 수원시", deadlineInDays: 21, sources: ["samsung"], hoursAgo: 40 },
];

const ORGS = ["달빛", "무지개", "아이터", "숲속", "새싹", "나래", "초록", "하늘", "보리", "은하", "다솜", "푸른"];
const REGIONS = ["서울 강서구", "서울 양천구", "서울 노원구", "서울 관악구", "서울 은평구", "경기 부천시", "경기 고양시", "인천 남동구"];
const TITLES = [
  "만 0세반 담임교사 모집",
  "만 4세반 담임교사 신입 가능",
  "보육교사 채용 (경력 무관)",
  "만 5세반 담임교사 모집 (신입 환영)",
  "통합반 보육교사 모집",
];
const SOURCE_CYCLE: (keyof typeof SOURCES)[] = ["work24", "seoul_center", "saramin", "work24"];
const DEADLINES: (number | null)[] = [5, null, 12, 7, 25, null, 3, 18];

function generated(count: number): Seed[] {
  return Array.from({ length: count }, (_, i) => ({
    org: `${ORGS[i % ORGS.length]}어린이집`,
    title: TITLES[i % TITLES.length],
    region: REGIONS[i % REGIONS.length],
    deadlineInDays: DEADLINES[i % DEADLINES.length],
    sources: [SOURCE_CYCLE[i % SOURCE_CYCLE.length]],
    hoursAgo: 48 + i * 5,
  }));
}

function kstDate(ms: number): string {
  return new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
}

/** 3쪽(20 + 20 + 이어서 몇 건)에 걸쳐 스크롤을 확인할 수 있는 만큼 만든다 */
export function buildSampleRows(now: Date = new Date()): FeedRow[] {
  return [...FEATURED, ...generated(44)].map((seed, i) => {
    const sources = seed.sources as string[];
    return {
      group_key: `sample-${String(i).padStart(3, "0")}`,
      title: seed.title,
      org_name: seed.org,
      region: seed.region,
      url: `https://example.com/sample-jobs/${i}`,
      deadline: seed.deadlineInDays === null ? null : kstDate(now.getTime() + seed.deadlineInDays * DAY),
      is_workplace: sources.some((code) => SOURCES[code as keyof typeof SOURCES].isWorkplace),
      sources,
      first_seen_at: new Date(now.getTime() - seed.hoursAgo * HOUR).toISOString(),
    };
  });
}
