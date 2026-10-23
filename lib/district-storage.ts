import { SEOUL_GU, parseDistricts, type SeoulGu } from "./districts";

/** 고른 구를 이 기기에 기억해 다음에 열 때 다시 걸어 준다. 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 화면은 그대로 동작한다 */
const KEY = "boyuk:districts";

/** 저장된 구. 없거나 읽을 수 없거나 서울의 구가 아닌 값이 섞여 있으면 빈 목록 */
export function readSavedDistricts(): SeoulGu[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) return [];
    const valid = parseDistricts(parsed);
    return valid ? SEOUL_GU.filter((gu) => valid.includes(gu)) : [];
  } catch {
    return [];
  }
}

export function saveDistricts(districts: readonly SeoulGu[]): void {
  try {
    if (districts.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(districts));
  } catch {
    // 저장하지 못해도 이번 화면의 필터는 그대로 동작한다
  }
}
