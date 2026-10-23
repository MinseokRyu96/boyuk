import { describe, expect, it } from "vitest";
import { htmlToText } from "./text";

describe("htmlToText", () => {
  it("문단·칸·줄바꿈 뒤에 줄바꿈을 넣어 붙어 있는 글자를 나눈다", () => {
    const lines = htmlToText("<p>근무지 : 서울 마포구</p><p>응시자격</p><div>a<br>b</div><table><tr><th>연락처</th><td>02-1234-5678</td></tr></table>")
      .split("\n")
      .filter(Boolean);
    expect(lines).toEqual(["근무지 : 서울 마포구", "응시자격", "a", "b", "연락처", "02-1234-5678"]);
  });

  it("빈 문서는 빈 글자", () => {
    expect(htmlToText("").trim()).toBe("");
  });
});
