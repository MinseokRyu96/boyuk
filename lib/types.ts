import type { SeoulGu } from "./districts";
import type { SourceCode } from "./sources";
import type { DDayLevel } from "./time";

/** 피드 조회 함수(get_feed)가 돌려주는 한 줄. 같은 공고는 이미 한 줄로 묶여 있다. */
export type FeedRow = {
  group_key: string;
  title: string;
  org_name: string | null;
  region: string | null;
  url: string;
  /** 'YYYY-MM-DD'. 상시채용이면 null */
  deadline: string | null;
  is_workplace: boolean;
  sources: string[];
  /** ISO 8601 */
  first_seen_at: string;
  /** 어린이집 위치(위도·경도). 아직 찾지 못했거나 0002 마이그레이션 전이면 null·없음 */
  lat?: number | null;
  lng?: number | null;
};

export type SourceBadge = { code: string; label: string };

/** 화면에 그대로 그릴 수 있게 가공한 카드. 시간에 따라 달라지는 값(D-day, NEW)은 서버에서 계산해 담는다. */
export type FeedCard = {
  key: string;
  orgName: string;
  title: string;
  region: string | null;
  dDay: { label: string; level: DDayLevel };
  sources: SourceBadge[];
  isNew: boolean;
  isWorkplace: boolean;
  url: string;
};

export type FeedPage = {
  cards: FeedCard[];
  /** 다음 페이지가 없으면 null */
  nextCursor: string | null;
  /** 구·출처 필터나 정렬이 걸린 요청에서만: 조건에 맞는 공고의 전체 수 (아직 불러오지 않은 쪽까지 센다) */
  total?: number;
};

/** 지금 보이는 공고의 건수. 필터 칩에 숫자를 붙이는 데 쓴다 (같은 공고는 이미 한 건으로 묶여 있다) */
export type FeedCounts = {
  /** 구를 모르는 공고까지 합친 전체 수 */
  total: number;
  byDistrict: Partial<Record<SeoulGu, number>>;
  /** 공고가 여러 출처에 걸쳐 있으면 출처마다 센다. 그래서 합이 total보다 클 수 있다 */
  bySource: Partial<Record<SourceCode, number>>;
};

/** 지도에 찍는 공고 하나. 카드와 같은 내용에 위치(위도·경도)를 더했다 */
export type MapPoint = FeedCard & { lat: number; lng: number };

export type MapData = {
  points: MapPoint[];
  /** 조건에 맞는 공고 수. 위치를 찾지 못한 공고도 센다 (total - points.length가 지도에 없는 공고 수) */
  total: number;
};
