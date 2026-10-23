/*
 * 서울의 구 필터. 화면(클라이언트)과 서버가 함께 쓰므로 server-only가 아닌 파일에 둔다.
 * 공고의 region은 "서울 마포구"처럼 시·도와 구를 공백으로 이은 짧은 표기다 (collectors/region.ts).
 */

/** 서울의 25개 구. 가나다순이라 화면에 그대로 늘어놓아도 순서가 일정하다 */
export const SEOUL_GU = [
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구",
  "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
] as const;

export type SeoulGu = (typeof SEOUL_GU)[number];

export function isSeoulGu(value: string): value is SeoulGu {
  return (SEOUL_GU as readonly string[]).includes(value);
}

/** region이 "서울 구이름" 모양이면 구 이름. "서울"만 있거나 다른 시·도면 undefined */
export function districtOf(region: string | null | undefined): SeoulGu | undefined {
  if (!region?.startsWith("서울 ")) return undefined;
  const name = region.slice("서울 ".length);
  return isSeoulGu(name) ? name : undefined;
}

/** districts가 비어 있으면 모두 통과. 아니면 region의 구가 그중 하나여야 한다 (구를 모르는 공고는 걸러진다) */
export function matchesDistricts(region: string | null | undefined, districts: readonly string[]): boolean {
  if (districts.length === 0) return true;
  const gu = districtOf(region);
  return gu !== undefined && districts.includes(gu);
}

/**
 * 주소의 gu 파라미터들(같은 이름을 여러 번 쓴다: ?gu=마포구&gu=서대문구)을 검사한다.
 * 서울의 구가 아닌 값이 하나라도 있으면 null, 아니면 중복을 뺀 목록(비어 있을 수 있다).
 */
export function parseDistricts(values: readonly string[]): SeoulGu[] | null {
  const result = new Set<SeoulGu>();
  for (const value of values) {
    if (!isSeoulGu(value)) return null;
    result.add(value);
  }
  return [...result];
}

/** 구별 공고 수. total은 구를 모르는 공고까지 합친 전체 수다 */
export type DistrictCounts = { total: number; byDistrict: Partial<Record<SeoulGu, number>> };
