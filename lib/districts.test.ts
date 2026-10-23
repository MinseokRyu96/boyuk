import { describe, expect, it } from "vitest";
import { SEOUL_GU, districtOf, isSeoulGu, matchesDistricts, parseDistricts } from "./districts";

describe("SEOUL_GU", () => {
  it("서울의 25개 구이고 중복이 없다", () => {
    expect(SEOUL_GU).toHaveLength(25);
    expect(new Set(SEOUL_GU).size).toBe(25);
  });
});

describe("districtOf", () => {
  it("'서울 구이름'에서 구를 꺼내고, 구가 없거나 다른 시·도면 undefined", () => {
    expect(districtOf("서울 마포구")).toBe("마포구");
    expect(districtOf("서울 중구")).toBe("중구");
    expect(districtOf("서울")).toBeUndefined();
    expect(districtOf("경기 성남시")).toBeUndefined();
    expect(districtOf("서울 성남시")).toBeUndefined();
    expect(districtOf(null)).toBeUndefined();
    expect(districtOf("")).toBeUndefined();
  });
});

describe("matchesDistricts", () => {
  it("선택한 구가 없으면 모두 통과한다 (구를 모르는 공고도)", () => {
    expect(matchesDistricts("서울", [])).toBe(true);
    expect(matchesDistricts(null, [])).toBe(true);
  });

  it("선택한 구 중 하나여야 통과하고, 구를 모르는 공고는 걸러진다", () => {
    expect(matchesDistricts("서울 마포구", ["마포구", "서대문구"])).toBe(true);
    expect(matchesDistricts("서울 은평구", ["마포구", "서대문구"])).toBe(false);
    expect(matchesDistricts("서울", ["마포구"])).toBe(false);
    expect(matchesDistricts(null, ["마포구"])).toBe(false);
  });
});

describe("parseDistricts", () => {
  it("서울의 구만 받고 중복은 하나로 합친다", () => {
    expect(parseDistricts(["마포구", "서대문구", "마포구"])).toEqual(["마포구", "서대문구"]);
    expect(parseDistricts([])).toEqual([]);
  });

  it("서울의 구가 아닌 값이 있으면 null", () => {
    expect(parseDistricts(["마포구", "성남시"])).toBeNull();
    expect(parseDistricts(["'; drop table jobs;--"])).toBeNull();
    expect(parseDistricts([""])).toBeNull();
  });
});

describe("isSeoulGu", () => {
  it("구 이름만 true", () => {
    expect(isSeoulGu("강남구")).toBe(true);
    expect(isSeoulGu("강남")).toBe(false);
  });
});
