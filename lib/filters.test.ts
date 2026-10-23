import { describe, expect, it } from "vitest";
import { hasFilters, matchesFilters } from "./filters";
import { ACTIVE_SOURCES, SOURCES, isSourceCode, parseSources } from "./sources";

const row = (region: string | null, sources: string[]) => ({ region, sources });

describe("matchesFilters", () => {
  it("조건이 없거나 비어 있으면 모두 통과한다", () => {
    expect(matchesFilters(row("서울 마포구", ["samsung"]), {})).toBe(true);
    expect(matchesFilters(row(null, ["samsung"]), { districts: [], sources: [] })).toBe(true);
  });

  it("출처는 묶인 공고의 출처 중 하나라도 고른 출처이면 통과한다", () => {
    expect(matchesFilters(row("서울 마포구", ["seoul_center", "work24"]), { sources: ["work24"] })).toBe(true);
    expect(matchesFilters(row("서울 마포구", ["seoul_center"]), { sources: ["samsung", "hansol"] })).toBe(false);
  });

  it("구와 출처를 함께 걸면 둘 다 만족해야 한다", () => {
    const filters = { districts: ["마포구"], sources: ["hansol"] };
    expect(matchesFilters(row("서울 마포구", ["hansol"]), filters)).toBe(true);
    expect(matchesFilters(row("서울 은평구", ["hansol"]), filters)).toBe(false);
    expect(matchesFilters(row("서울 마포구", ["samsung"]), filters)).toBe(false);
  });
});

describe("hasFilters", () => {
  it("구나 출처 중 하나라도 골랐으면 true", () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ districts: [], sources: [] })).toBe(false);
    expect(hasFilters({ districts: ["마포구"] })).toBe(true);
    expect(hasFilters({ sources: ["samsung"] })).toBe(true);
  });
});

describe("출처 코드", () => {
  it("알려진 출처 코드만 받고 객체의 기본 속성 이름은 받지 않는다", () => {
    expect(isSourceCode("samsung")).toBe(true);
    expect(isSourceCode("unknown")).toBe(false);
    expect(isSourceCode("constructor")).toBe(false);
    expect(isSourceCode("__proto__")).toBe(false);
  });

  it("parseSources: 중복은 하나로 합치고, 모르는 값이 있으면 null", () => {
    expect(parseSources(["samsung", "hansol", "samsung"])).toEqual(["samsung", "hansol"]);
    expect(parseSources([])).toEqual([]);
    expect(parseSources(["samsung", "naver"])).toBeNull();
    expect(parseSources([""])).toBeNull();
  });

  it("지금 수집하는 출처(ACTIVE_SOURCES)는 모두 알려진 출처이다", () => {
    for (const code of ACTIVE_SOURCES) expect(code in SOURCES).toBe(true);
  });
});
