import { describe, expect, it } from "vitest";
import { inferRegion, isInTargetRegion, normalizeRegion } from "./region";

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

describe("inferRegion — 지역 칸이 없는 출처의 글자에서 서울을 읽는다", () => {
  it("서울에만 있는 구 이름이 있으면 서울 + 구", () => {
    expect(inferRegion("[서대문구] 세브란스 어린이집 교사모집")).toBe("서울 서대문구");
    expect(inferRegion("마포구 상암동 LGU+상암사옥 어린이집")).toBe("서울 마포구");
  });

  it("'서울'이라는 글자가 있으면 서울", () => {
    expect(inferRegion("삼성서울병원어린이집 보육교사")).toBe("서울");
    expect(inferRegion("서울형어린이집 담임교사")).toBe("서울");
  });

  it("다른 도시에도 있는 구(강서구·중구)와 서울이 아닌 곳은 읽지 않는다", () => {
    expect(inferRegion("강서구 어린이집 담임교사")).toBeUndefined();
    expect(inferRegion("중구 어린이집 담임교사")).toBeUndefined();
    expect(inferRegion("포항남부경찰서어린이집 담임교사")).toBeUndefined();
    expect(inferRegion("수원 영통구 어린이집")).toBeUndefined();
  });

  it("글자가 없으면 undefined", () => {
    expect(inferRegion(undefined)).toBeUndefined();
    expect(inferRegion("")).toBeUndefined();
  });
});

describe("isInTargetRegion", () => {
  it("시·도가 보여 줄 곳에 속하면 true", () => {
    expect(isInTargetRegion("서울 강서구", ["서울"])).toBe(true);
    expect(isInTargetRegion("서울", ["서울"])).toBe(true);
    expect(isInTargetRegion("경기 성남시", ["서울", "경기"])).toBe(true);
  });

  it("다른 시·도이거나 지역을 모르면 false", () => {
    expect(isInTargetRegion("경기 성남시", ["서울"])).toBe(false);
    expect(isInTargetRegion("서울특별시 강서구", ["서울"])).toBe(false); // 짧은 표기(normalizeRegion 결과)만 받는다
    expect(isInTargetRegion(undefined, ["서울"])).toBe(false);
    expect(isInTargetRegion("", ["서울"])).toBe(false);
  });

  it("보여 줄 곳을 비워 두면 전국을 모두 허용한다 (지역을 몰라도)", () => {
    expect(isInTargetRegion("부산", [])).toBe(true);
    expect(isInTargetRegion(undefined, [])).toBe(true);
  });
});
