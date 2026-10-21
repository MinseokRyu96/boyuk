import { avatarInitial } from "./avatar";
import { dDay, isNewPosting } from "./time";
import { sortSources, sourceLabel } from "./sources";
import type { FeedCard, FeedRow } from "./types";

/** DB의 묶인 행을 화면용 카드로 바꾼다. D-day와 NEW처럼 시간에 따라 달라지는 값은 여기서 정한다 */
export function toCard(row: FeedRow, now: Date): FeedCard {
  const sources = sortSources(row.sources).map((code) => ({ code, label: sourceLabel(code) }));
  // 어린이집명이 없으면 출처 이름으로 대신한다 (PRD 8장)
  const orgName = row.org_name?.trim() || sources[0]?.label || "어린이집";
  return {
    key: row.group_key,
    orgName,
    initial: avatarInitial(orgName),
    title: row.title,
    region: row.region,
    dDay: dDay(row.deadline, now),
    sources,
    isNew: isNewPosting(row.first_seen_at, now),
    isWorkplace: row.is_workplace,
    url: row.url,
  };
}
