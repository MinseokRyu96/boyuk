import { load } from "cheerio";

/**
 * HTML의 글자를 줄 단위로 꺼낸다. 문단(p)·칸(td)·줄바꿈(br) 뒤에 줄바꿈을 넣어서,
 * 사이트가 문단 사이에 공백을 두지 않아도 "근무지 : 서울 마포구"와 다음 문단이 한 줄로 붙지 않게 한다.
 */
export function htmlToText(html: string): string {
  const $ = load(html);
  $("br").replaceWith("\n");
  $("p, div, li, tr, td, th, h1, h2, h3, h4").append("\n");
  return $.root().text();
}
