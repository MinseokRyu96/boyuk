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
};

export type SourceBadge = { code: string; label: string };

/** 화면에 그대로 그릴 수 있게 가공한 카드. 시간에 따라 달라지는 값(D-day, NEW)은 서버에서 계산해 담는다. */
export type FeedCard = {
  key: string;
  orgName: string;
  /** 로고 대신 아바타에 보여주는 어린이집 이름의 첫 글자 */
  initial: string;
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
