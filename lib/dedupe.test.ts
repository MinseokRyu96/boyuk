import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeOrgName } from "./dedupe";

describe("normalizeOrgName", () => {
  it("공백·괄호·특수문자와 법인 표기를 없앤다", () => {
    expect(normalizeOrgName("(재)푸르니 해오름 어린이집")).toBe("푸르니해오름어린이집");
    expect(normalizeOrgName("㈜모아맘 · 별빛어린이집")).toBe("모아맘별빛어린이집");
  });

  it("영문은 소문자로 맞춘다", () => {
    expect(normalizeOrgName("ABC 어린이집")).toBe("abc어린이집");
  });
});

describe("dedupeKey — 수락 기준 F6", () => {
  it("어린이집명과 마감일이 같으면 같은 키를 만든다", () => {
    expect(dedupeKey("해오름 어린이집", "2026-11-30")).toBe(dedupeKey("해오름어린이집", "2026-11-30"));
    expect(dedupeKey("(재)해오름어린이집", "2026-11-30")).toBe(dedupeKey("해오름어린이집", "2026-11-30"));
  });

  it("마감일이 다르면 다른 키를 만든다", () => {
    expect(dedupeKey("해오름어린이집", "2026-11-30")).not.toBe(dedupeKey("해오름어린이집", "2026-12-01"));
  });

  it("어린이집명이 다르면 다른 키를 만든다", () => {
    expect(dedupeKey("해오름어린이집", "2026-11-30")).not.toBe(dedupeKey("별빛어린이집", "2026-11-30"));
  });

  it("어린이집명이 없으면 null이라 합쳐지지 않는다", () => {
    expect(dedupeKey(undefined, "2026-11-30")).toBeNull();
    expect(dedupeKey("", "2026-11-30")).toBeNull();
    expect(dedupeKey("어린이집", "2026-11-30")).toBeNull();
  });

  it("마감일이 없으면 같은 공고임을 확인할 수 없어 null이다", () => {
    expect(dedupeKey("해오름어린이집", undefined)).toBeNull();
  });
});
