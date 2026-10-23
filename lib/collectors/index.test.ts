import { afterEach, describe, expect, it, vi } from "vitest";
import { findCollector } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("findCollector", () => {
  it("주소 값(slug)으로 수집기를 찾는다 (seoul-center는 seoul_center 소스)", () => {
    expect(findCollector("work24")?.source).toBe("work24");
    expect(findCollector("saramin")?.source).toBe("saramin");
    expect(findCollector("seoul-center")?.source).toBe("seoul_center");
  });

  it("알 수 없는 값과 객체의 기본 속성 이름은 찾지 못한다", () => {
    expect(findCollector("unknown")).toBeUndefined();
    expect(findCollector("constructor")).toBeUndefined();
    expect(findCollector("__proto__")).toBeUndefined();
    expect(findCollector("seoul_center")).toBeUndefined();
  });

  it("고용24·사람인·서울센터·모아맘·한솔·푸르니는 구현되어 있고, 나머지 소스는 아직 구현 전이다", () => {
    for (const slug of ["work24", "saramin", "seoul-center", "moamam", "hansol", "purunee"]) {
      expect(findCollector(slug)?.implemented).not.toBe(false);
    }
    for (const slug of ["samsung"]) {
      expect(findCollector(slug)?.implemented).toBe(false);
    }
  });

  it("직장어린이집 운영업체만 is_workplace가 켜져 있다", () => {
    expect(findCollector("work24")?.isWorkplace).toBe(false);
    expect(findCollector("saramin")?.isWorkplace).toBe(false);
    expect(findCollector("moamam")?.isWorkplace).toBe(true);
  });

  it("인증키가 환경변수에 없으면 수집이 안내와 함께 실패한다 (요청은 보내지 않는다)", async () => {
    vi.stubEnv("WORK24_API_KEY", "");
    vi.stubEnv("SARAMIN_API_KEY", "");
    await expect(findCollector("work24")?.fetchJobs()).rejects.toThrow(/WORK24_API_KEY/);
    await expect(findCollector("saramin")?.fetchJobs()).rejects.toThrow(/SARAMIN_API_KEY/);
  });
});
