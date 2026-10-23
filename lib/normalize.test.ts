import { describe, expect, it } from "vitest";
import type { RawJob } from "./collectors/types";
import { isChildcareContext, isTarget } from "./normalize";

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

  it("'보조 선생님'·'대체 선생님'·연장 전담 표현도 담임이 아니므로 제외한다", () => {
    // 서울센터는 직종이 보육교사로 같아서, 담임이 아닌 공고는 제목 표현으로만 가릴 수 있다
    expect(isTarget(job("보조 선생님 구인합니다", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("대체 선생님 구합니다", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("대체교사 모집", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("출산휴가 및 육아휴직대체보육교사"))).toBe(false);
    expect(isTarget(job("연장전담교사 모집", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("연장보육 전담교사 채용 공고", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("담임교사 및 보조 선생님 모집", { rawText: "보육교사" }))).toBe(true);
  });

  it("'비담임'은 담임이 아니고, '연장교사'·'연장 전임 교사'도 제외한다", () => {
    expect(isTarget(job("서울형비담임교사 모집합니다.", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("비담임교사", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("영아 연장교사를 채용합니다.", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("연장 전임 교사", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("8시간 보조&연장겸직 교사 채용", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("보조·연장 교사 채용", { rawText: "보육교사" }))).toBe(false);
    expect(isTarget(job("담임교사와 비담임교사 모집", { rawText: "보육교사" }))).toBe(true);
    expect(isTarget(job("0세반 담임교사 모집", { rawText: "보육교사" }))).toBe(true);
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

describe("isChildcareContext — 범용 채용 소스의 학원·학교 공고를 거른다", () => {
  it("제목·기관명·업종·직무 분류 어디에든 어린이집·보육·영유아가 있으면 통과한다", () => {
    expect(isChildcareContext(job("해오름어린이집 담임교사 모집"))).toBe(true);
    expect(isChildcareContext(job("담임교사 모집", { orgName: "별빛어린이집" }))).toBe(true);
    expect(isChildcareContext(job("담임교사 모집", { contextText: "영유아 보육시설" }))).toBe(true);
    expect(isChildcareContext(job("담임교사 모집", { rawText: "신입 보육교사" }))).toBe(true);
  });

  it("학원·학교·유치원의 담임교사는 어린이집이 아니므로 거른다", () => {
    expect(isChildcareContext(job("초등부 담임교사 모집 (신입 가능)", { orgName: "스마일학원", contextText: "학원" }))).toBe(false);
    expect(isChildcareContext(job("담임교사 채용", { orgName: "햇살초등학교" }))).toBe(false);
    expect(isChildcareContext(job("유치원 담임교사 모집", { orgName: "숲유치원" }))).toBe(false);
  });
});
