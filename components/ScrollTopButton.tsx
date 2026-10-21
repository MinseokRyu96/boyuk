"use client";

import { IconArrowUpLine } from "@karrotmarket/react-monochrome-icon";
import { PrefixIcon } from "@seed-design/react";
import { useEffect, useState } from "react";
import { ContextualFloatingButton } from "seed-design/ui/contextual-floating-button";

/** 이만큼 내려오면 "맨 위로" 버튼을 보여준다 (카드 5~6장 정도) */
const SHOW_AFTER_PX = 900;

/** 공고가 많이 쌓여도 한 번에 맨 위(가장 새 공고)로 돌아오게 하는 떠 있는 버튼 */
export function ScrollTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  // 바깥 상자는 클릭을 가로채지 않고, 버튼만 눌리도록 한다.
  // 아래 여백은 SEED 토큰(bottom-x5)이 아니라 Tailwind 기본 값(bottom-5)이다. SEED 테마는 inset 유틸리티에는 x 토큰을 주지 않는다.
  // SEED 버튼은 높이가 36px이라 터치 영역 기준(44px)에 맞게 min-h-11을 준다.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center">
      <ContextualFloatingButton
        variant="solid"
        className="pill-in pointer-events-auto min-h-11"
        onClick={() => {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        }}
      >
        <PrefixIcon svg={<IconArrowUpLine />} />
        맨 위로
      </ContextualFloatingButton>
    </div>
  );
}
