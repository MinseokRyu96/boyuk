import { matchesDistricts } from "./districts";
import type { FeedRow } from "./types";

/** 화면과 서버가 함께 쓰는 공고 필터. 비어 있거나 생략한 조건은 걸지 않는다 */
export type FeedFilters = {
  /** 서울의 구 (lib/districts.ts). 고른 구 중 하나여야 한다 */
  districts?: readonly string[];
  /** 수집 출처 코드 (lib/sources.ts). 묶인 공고의 출처 중 하나라도 고른 출처이면 통과한다 */
  sources?: readonly string[];
};

export function hasFilters(filters: FeedFilters): boolean {
  return (filters.districts?.length ?? 0) > 0 || (filters.sources?.length ?? 0) > 0;
}

export function matchesFilters(row: Pick<FeedRow, "region" | "sources">, filters: FeedFilters): boolean {
  if (!matchesDistricts(row.region, filters.districts ?? [])) return false;
  const sources = filters.sources ?? [];
  return sources.length === 0 || row.sources.some((code) => sources.includes(code));
}
