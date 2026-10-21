import { describe, expect, it } from "vitest";
import { dDay, daysUntil, isNewPosting, kstToday, relativeTime } from "./time";

describe("kstToday", () => {
  it("UTC 15시는 한국 시간으로 이미 다음 날이다", () => {
    expect(kstToday(new Date("2026-10-21T14:59:59Z"))).toBe("2026-10-21");
    expect(kstToday(new Date("2026-10-21T15:00:00Z"))).toBe("2026-10-22");
  });
});

describe("dDay", () => {
  const now = new Date("2026-10-21T03:00:00Z"); // 한국 시간 2026-10-21 12시

  it("마감일이 없으면 상시", () => {
    expect(dDay(null, now)).toEqual({ label: "상시", level: "open" });
  });

  it("오늘이 마감이면 오늘마감, D-3 이하는 강조 단계로 나눈다", () => {
    expect(dDay("2026-10-21", now)).toEqual({ label: "오늘마감", level: "today" });
    expect(dDay("2026-10-22", now)).toEqual({ label: "D-1", level: "soon" });
    expect(dDay("2026-10-24", now)).toEqual({ label: "D-3", level: "soon" });
    expect(dDay("2026-10-25", now)).toEqual({ label: "D-4", level: "normal" });
  });

  it("월을 넘겨도 날수를 바르게 센다", () => {
    expect(daysUntil("2026-11-02", now)).toBe(12);
  });
});

describe("isNewPosting", () => {
  const now = new Date("2026-10-21T12:00:00Z");

  it("24시간 이내만 NEW", () => {
    expect(isNewPosting("2026-10-21T00:00:00Z", now)).toBe(true);
    expect(isNewPosting("2026-10-20T12:00:01Z", now)).toBe(true);
    expect(isNewPosting("2026-10-20T12:00:00Z", now)).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-21T12:00:00Z");

  it("분·시간·일 단위로 줄여 보여준다", () => {
    expect(relativeTime("2026-10-21T11:59:40Z", now)).toBe("방금 전");
    expect(relativeTime("2026-10-21T11:48:00Z", now)).toBe("12분 전");
    expect(relativeTime("2026-10-21T09:00:00Z", now)).toBe("3시간 전");
    expect(relativeTime("2026-10-19T12:00:00Z", now)).toBe("2일 전");
  });
});
