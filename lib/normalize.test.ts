import { describe, expect, it } from "vitest";
import type { RawJob } from "./collectors/types";
import { isTarget } from "./normalize";

const job = (title: string, extra: Partial<RawJob> = {}): RawJob => ({
  sourceId: "1",
  title,
  url: "https://example.com/1",
  ...extra,
});

describe("isTarget — 수락 기준 F5", () => {
  it("신입·경력 무관 담임/보육교사 공고는 저장한다", () => {
    expect(isTarget(job("[신입] 1세반 담임교사 모집"))).toBe(true);
    expect(isTarget(job("해오름어린이집 보육교사 채용 (경력무관)"))).toBe(true);
    expect(isTarget(job("담임교사 모집", { rawText: "신입 가능, 경력 우대" }))).toBe(true);
    expect(isTarget(job("보육교사 모집", { rawText: "신입 환영" }))).toBe(true);
  });

  it("'경력 3년 이상'만 있는 공고는 저장하지 않는다", () => {
    expect(isTarget(job("담임교사 모집 (경력 3년 이상)"))).toBe(false);
    expect(isTarget(job("보육교사 채용", { rawText: "3년 이상 경력자만 지원" }))).toBe(false);
    expect(isTarget(job("담임교사 경력직 채용"))).toBe(false);
  });

  it("원장·조리원 등 다른 직무가 주된 대상이면 저장하지 않는다", () => {
    expect(isTarget(job("어린이집 원장 모집 (신입 가능)"))).toBe(false);
    expect(isTarget(job("조리원 모집 경력무관"))).toBe(false);
    expect(isTarget(job("영양사 채용 신입"))).toBe(false);
    expect(isTarget(job("간호사 모집", { careerHint: "any" }))).toBe(false);
    expect(isTarget(job("운전기사 및 사무직원 모집"))).toBe(false);
  });
});

describe("isTarget — 경력 판별", () => {
  it("신입 표현과 경력 표현이 함께 있으면 신입이 우선한다", () => {
    expect(isTarget(job("담임교사 모집 (신입 가능, 경력 3년 이상 우대)"))).toBe(true);
  });

  it("'신입 불가'는 신입 표현으로 치지 않는다", () => {
    expect(isTarget(job("담임교사 모집 (신입 불가, 경력 2년 이상)"))).toBe(false);
  });

  it("경력자 우대는 필수 조건이 아니므로 걸러내지 않는다", () => {
    expect(isTarget(job("담임교사 모집 (경력자 우대)"))).toBe(true);
    expect(isTarget(job("담임교사 모집 (경력 1년 이상 우대)"))).toBe(true);
  });

  it("경력 정보가 전혀 없으면 애매하므로 저장한다", () => {
    expect(isTarget(job("2세반 담임교사 모집"))).toBe(true);
  });

  it("API의 경력 구분 값을 따른다", () => {
    expect(isTarget(job("담임교사 모집", { careerHint: "new" }))).toBe(true);
    expect(isTarget(job("담임교사 모집", { careerHint: "any" }))).toBe(true);
    expect(isTarget(job("담임교사 모집", { careerHint: "experienced" }))).toBe(false);
    expect(isTarget(job("담임교사 신입 가능", { careerHint: "experienced" }))).toBe(true);
  });
});

describe("isTarget — 직무 판별", () => {
  it("보조교사·연장반교사는 담임이 아니면 제외한다", () => {
    expect(isTarget(job("보조교사 모집 신입"))).toBe(false);
    expect(isTarget(job("연장반 보육교사 모집 신입"))).toBe(false);
    expect(isTarget(job("담임 및 보조교사 모집 신입"))).toBe(true);
  });

  it("제목에 담임과 다른 직무가 함께 있으면 애매하므로 저장한다", () => {
    expect(isTarget(job("담임교사 및 조리원 모집 신입"))).toBe(true);
  });

  it("제목에 직무가 없으면 본문(직무명)으로 판단한다", () => {
    expect(isTarget(job("2026년 하반기 채용", { rawText: "직무: 보육교사 / 신입 가능" }))).toBe(true);
    expect(isTarget(job("2026년 하반기 채용", { rawText: "직무: 시설관리 / 신입 가능" }))).toBe(false);
  });

  it("담임·보육교사라고 쓰지 않았어도 교사를 구하면 저장한다", () => {
    expect(isTarget(job("어린이집 교사 모집 신입"))).toBe(true);
  });
});
