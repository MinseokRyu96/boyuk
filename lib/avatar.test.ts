import { describe, expect, it } from "vitest";
import { AVATAR_TONE_COUNT, avatarOf } from "./avatar";

describe("avatarOf", () => {
  it("법인 표기와 괄호를 건너뛰고 이름의 첫 글자를 쓴다", () => {
    expect(avatarOf("(재)푸르니 별빛어린이집").initial).toBe("푸");
    expect(avatarOf("㈜모아맘 햇살어린이집").initial).toBe("모");
    expect(avatarOf("abc 어린이집").initial).toBe("A");
  });

  it("같은 이름은 항상 같은 색이고, 색 번호는 범위 안이다", () => {
    const names = ["해오름어린이집", "달빛어린이집", "푸르니 별빛어린이집", "한솔 꿈나무어린이집", "사람인"];
    for (const name of names) {
      expect(avatarOf(name)).toEqual(avatarOf(name));
      expect(avatarOf(name).tone).toBeGreaterThanOrEqual(0);
      expect(avatarOf(name).tone).toBeLessThan(AVATAR_TONE_COUNT);
    }
  });

  it("'~어린이집'으로 끝나는 이름들도 색이 고르게 나뉜다", () => {
    const first = "가나다라마바사아자차카타파하해달별숲새초";
    const second = "름빛별터리솔움들나래";
    const counts = Array<number>(AVATAR_TONE_COUNT).fill(0);
    let total = 0;
    for (const a of first) {
      for (const b of second) {
        counts[avatarOf(`${a}${b}어린이집`).tone]++;
        total++;
      }
    }
    // 한 색이 전체의 35%를 넘거나 10%에 못 미치면 몰린 것으로 본다
    for (const count of counts) {
      expect(count / total).toBeGreaterThan(0.1);
      expect(count / total).toBeLessThan(0.35);
    }
  });

  it("글자가 하나도 남지 않는 이름은 기본 글자를 쓴다", () => {
    expect(avatarOf("()").initial).toBe("공");
  });
});
