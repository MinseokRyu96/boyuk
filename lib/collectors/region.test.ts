import { describe, expect, it } from "vitest";
import { normalizeRegion } from "./region";

describe("normalizeRegion", () => {
  it("사람인 표기('서울 > 강서구')를 시·구 단위로 줄인다", () => {
    expect(normalizeRegion("서울 > 강서구")).toBe("서울 강서구");
    expect(normalizeRegion("경기 > 성남시 분당구")).toBe("경기 성남시");
  });

  it("여러 지역이 오면 첫 번째만 쓴다", () => {
    expect(normalizeRegion("서울 > 관악구,서울 > 광진구,서울 > 구로구")).toBe("서울 관악구");
  });

  it("주소 형태와 긴 시·도 이름도 같은 표기로 맞춘다", () => {
    expect(normalizeRegion("서울특별시 강서구 화곡로 1")).toBe("서울 강서구");
    expect(normalizeRegion("경기도 수원시 영통구")).toBe("경기 수원시");
    expect(normalizeRegion("충청남도 천안시")).toBe("충남 천안시");
    expect(normalizeRegion("제주특별자치도 제주시")).toBe("제주 제주시");
  });

  it("HTML 이스케이프된 구분자도 읽는다", () => {
    expect(normalizeRegion("서울 &gt; 양천구")).toBe("서울 양천구");
  });

  it("구·시 정보가 없으면 시·도만 돌려준다", () => {
    expect(normalizeRegion("서울")).toBe("서울");
    expect(normalizeRegion("세종특별자치시 한솔동")).toBe("세종");
  });

  it("알아볼 수 없으면 undefined", () => {
    expect(normalizeRegion("")).toBeUndefined();
    expect(normalizeRegion(undefined)).toBeUndefined();
    expect(normalizeRegion("재택근무")).toBeUndefined();
  });
});
