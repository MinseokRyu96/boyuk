import { describe, expect, it } from "vitest";
import { parseLooseDate } from "./dates";

describe("parseLooseDate", () => {
  it("흔한 날짜 표기를 YYYY-MM-DD로 바꾼다", () => {
    expect(parseLooseDate("2025-10-30")).toBe("2025-10-30");
    expect(parseLooseDate("2025.10.30")).toBe("2025-10-30");
    expect(parseLooseDate("2025/1/5")).toBe("2025-01-05");
    expect(parseLooseDate("20251030")).toBe("2025-10-30");
    expect(parseLooseDate("2025년 10월 30일")).toBe("2025-10-30");
  });

  it("두 자리 연도(25-10-30)는 2000년대로 읽는다", () => {
    expect(parseLooseDate("25-10-30")).toBe("2025-10-30");
    expect(parseLooseDate("25.10.30")).toBe("2025-10-30");
  });

  it("요일이나 시각이 붙어 있어도 날짜만 꺼낸다", () => {
    expect(parseLooseDate("2025-10-30 18:00")).toBe("2025-10-30");
    expect(parseLooseDate("25-10-30(목)")).toBe("2025-10-30");
    expect(parseLooseDate("~ 2025.11.02")).toBe("2025-11-02");
  });

  it("날짜가 없는 문구는 undefined라서 마감일 없는 공고로 다뤄진다", () => {
    expect(parseLooseDate("채용시까지")).toBeUndefined();
    expect(parseLooseDate("상시채용")).toBeUndefined();
    expect(parseLooseDate("")).toBeUndefined();
    expect(parseLooseDate(undefined)).toBeUndefined();
    expect(parseLooseDate(null)).toBeUndefined();
  });

  it("달력에 없는 날짜는 거른다", () => {
    expect(parseLooseDate("2025-02-30")).toBeUndefined();
    expect(parseLooseDate("2025-13-01")).toBeUndefined();
    expect(parseLooseDate("2024-02-29")).toBe("2024-02-29");
  });
});
