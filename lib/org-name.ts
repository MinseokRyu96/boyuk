/** 법인 형태 표기. 출처마다 붙이는 방식이 달라 같은 어린이집이 다르게 보이는 것을 막는다 */
const CORPORATE_MARK = /\((주|재|사|복|학|유)\)|㈜|주식회사|유한회사|재단법인|사단법인|사회복지법인|학교법인/g;

/** 어린이집명을 비교·식별용으로 정규화한다: 법인 표기, 공백, 특수문자를 없애고 소문자로 맞춘다 */
export function normalizeOrgName(name: string | undefined): string {
  return (name ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(CORPORATE_MARK, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}
