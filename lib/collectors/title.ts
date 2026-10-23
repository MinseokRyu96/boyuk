/** 제목 앞머리의 "[정기] [전국]" 같은 대괄호 표시 */
export const BRACKETS = /\[[^\]]*\]/g;

/**
 * 제목에서 어린이집 이름을 꺼낸다: 대괄호와 앞의 연도를 뺀 맨 앞에서 첫 "…어린이집"까지.
 * 어린이집 이름이 없거나("2027년 보육교사 정기채용"), 채용 문구가 섞여 이름이 아닌 것 같으면 undefined.
 * 목록에 어린이집 이름 칸이 따로 없는 사이트(한솔·푸르니)가 쓴다.
 */
export function orgNameFromTitle(title: string): string | undefined {
  const text = title.replace(BRACKETS, " ").replace(/^\s*20\d{2}\s*(?:년도?)?\s+/, "");
  // 이름 뒤에는 공백이나 괄호가 온다 ("…어린이집(출산 및 육아휴직) 대체교사")
  const name = /^\s*(\S.*?어린이집)(?=[\s(（]|$)/.exec(text)?.[1];
  return name && !/채용|모집|공고/.test(name) ? name : undefined;
}
