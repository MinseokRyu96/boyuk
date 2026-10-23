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
};

/** 지도에 찍는 공고 하나. 카드와 같은 내용에 위치(위도·경도)를 더했다 */
export type MapPoint = FeedCard & { lat: number; lng: number };

export type MapData = {
  points: MapPoint[];
  /** 조건에 맞는 공고 수. 위치를 찾지 못한 공고도 센다 (total - points.length가 지도에 없는 공고 수) */
  total: number;
};
