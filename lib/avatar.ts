import { normalizeOrgName } from "./org-name";

/** 로고 대신 쓰는 어린이집 타일의 글자: 법인 표기·괄호를 건너뛴 이름의 첫 글자 */
export function avatarInitial(name: string): string {
  return Array.from(normalizeOrgName(name))[0]?.toUpperCase() ?? "공";
}
