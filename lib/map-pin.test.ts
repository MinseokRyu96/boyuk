import { describe, expect, it } from "vitest";
import { CLUSTER_CALCULATOR, CLUSTER_STYLES, PIN_COLOR, PIN_SELECTED_COLOR, pinCountText, pinImageSrc, pinSvg } from "./map-pin";

describe("pinCountText", () => {
  it("공고가 1건이면 숫자를 쓰지 않고, 10건부터는 9+로 줄인다", () => {
    expect(pinCountText(1)).toBeNull();
    expect(pinCountText(2)).toBe("2");
    expect(pinCountText(9)).toBe("9");
    expect(pinCountText(10)).toBe("9+");
    expect(pinCountText(37)).toBe("9+");
  });
});

describe("pinSvg", () => {
  it("공고가 여럿이면 핀 안에 건수를 쓰고, 1건이면 흰 점만 둔다", () => {
    expect(pinSvg(3)).toContain(">3</text>");
    expect(pinSvg(1)).not.toContain("<text");
  });

  it("고른 핀은 더 크고 진한 색이다", () => {
    expect(pinSvg(1)).toContain(`width="32" height="42"`);
    expect(pinSvg(1)).toContain(PIN_COLOR);
    expect(pinSvg(1, true)).toContain(`width="40" height="52"`);
    expect(pinSvg(1, true)).toContain(PIN_SELECTED_COLOR);
  });

  it("이미지 주소는 SVG를 그대로 담은 data URI다", () => {
    const src = pinImageSrc(2);
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(src.split(",")[1])).toBe(pinSvg(2));
  });
});

describe("클러스터 모양", () => {
  it("경계값보다 모양이 하나 더 많고, 단계가 오를수록 원이 커진다", () => {
    expect(CLUSTER_STYLES).toHaveLength(CLUSTER_CALCULATOR.length + 1);
    const sizes = CLUSTER_STYLES.map((style) => Number.parseInt(style.width, 10));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});
