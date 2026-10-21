"use client";

import { useEffect, useState } from "react";

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

  return (
    <button
      type="button"
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
      className="pill-in fixed bottom-5 left-1/2 z-20 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-5 text-[15px] font-semibold text-white shadow-[0_6px_20px_rgb(11_107_93/0.35)] active:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M5 12l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      맨 위로
    </button>
  );
}
