import { normalizeOrgName } from "./org-name";

/** 어린이집 타일의 색 가짓수. 화면의 색 배열과 개수를 맞춘다 */
export const AVATAR_TONE_COUNT = 5;

/**
 * 로고 대신 쓰는 어린이집 타일: 이름의 첫 글자와 색 번호.
 * 같은 이름은 언제나 같은 색이라 카드를 훑을 때 어린이집을 눈으로 구분하는 데 도움이 된다.
 */
export function avatarOf(name: string): { initial: string; tone: number } {
  const normalized = normalizeOrgName(name);
  const initial = Array.from(normalized)[0]?.toUpperCase() ?? "공";
  // FNV-1a. 이름이 대부분 "~어린이집"으로 끝나 비슷한 이름이 많아서, 글자를 고르게 섞는 해시를 쓴다
  // (이름 18개 표본에서 단순한 31배 해시는 7/18이 한 색에 몰렸고 FNV-1a는 5/18까지만 몰렸다)
  let hash = 2166136261;
  for (const ch of normalized) hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  return { initial, tone: hash % AVATAR_TONE_COUNT };
}
