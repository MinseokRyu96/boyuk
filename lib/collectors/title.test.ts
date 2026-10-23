import { describe, expect, it } from "vitest";
import { orgNameFromTitle } from "./title";

describe("orgNameFromTitle", () => {
  it("대괄호와 앞의 연도를 빼고 첫 '…어린이집'까지를 이름으로 쓴다", () => {
    expect(orgNameFromTitle("가나다어린이집 영아반 담임교사 채용공고")).toBe("가나다어린이집");
    expect(orgNameFromTitle("[서울] 2026 사아자 직장어린이집 담임교사 모집")).toBe("사아자 직장어린이집");
    expect(orgNameFromTitle("2026년 라마바 R&D캠퍼스 직장어린이집 조리사 채용")).toBe("라마바 R&D캠퍼스 직장어린이집");
  });

  it("이름 뒤에 괄호가 바로 이어져도 이름만 쓴다", () => {
    expect(orgNameFromTitle("마바사경찰서어린이집(출산 및 육아휴직) 대체교사 채용 공고")).toBe("마바사경찰서어린이집");
  });

  it("어린이집 이름이 없거나 채용 문구가 섞이면 이름 없음", () => {
    expect(orgNameFromTitle("[정기] [전국] 2027년 보육교사 정기채용")).toBeUndefined();
    expect(orgNameFromTitle("2027년 정기채용 어린이집 담임교사 모집")).toBeUndefined();
  });
});
