import { describe, expect, it } from "vitest";
import { avatarInitial } from "./avatar";

describe("avatarInitial", () => {
  it("법인 표기와 괄호를 건너뛰고 이름의 첫 글자를 쓴다", () => {
    expect(avatarInitial("(재)푸르니 별빛어린이집")).toBe("푸");
    expect(avatarInitial("㈜모아맘 햇살어린이집")).toBe("모");
    expect(avatarInitial("abc 어린이집")).toBe("A");
  });

  it("글자가 하나도 남지 않는 이름은 기본 글자를 쓴다", () => {
    expect(avatarInitial("()")).toBe("공");
    expect(avatarInitial("")).toBe("공");
  });
});
