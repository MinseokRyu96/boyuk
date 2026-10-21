"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedPage } from "@/lib/types";
import { SkeletonCard } from "./FeedSkeleton";
import { JobCard } from "./JobCard";
import { RetryNotice } from "./RetryNotice";

type Status = "idle" | "loading" | "error";

async function requestPage(cursor: string | null): Promise<FeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`/api/jobs${query}`);
  if (!res.ok) throw new Error(`공고 요청 실패 (${res.status})`);
  return res.json();
}

/** 최신순 공고 목록. 끝에 가까워지면 다음 20건을 이어서 불러온다 (F1) */
export function Feed({ initial }: { initial: FeedPage }) {
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [status, setStatus] = useState<Status>("idle");
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (busy.current || !cursor) return;
    busy.current = true;
    setStatus("loading");
    try {
      const page = await requestPage(cursor);
      setCards((prev) => {
        const seen = new Set(prev.map((card) => card.key));
        return [...prev, ...page.cards.filter((card) => !seen.has(card.key))];
      });
      setCursor(page.nextCursor);
      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [cursor]);

  /** 처음부터 다시 받는다. 빈 화면의 "다시 불러오기"가 쓴다 */
  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus("loading");
    try {
      const page = await requestPage(null);
      setCards(page.cards);
      setCursor(page.nextCursor);
      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, []);

  // 목록 끝 근처에 닿으면 다음 페이지를 요청한다. 오류가 나면 관찰을 멈춰 같은 요청이 반복되지 않게 한다.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || status !== "idle") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, status, loadMore]);

  if (cards.length === 0) {
    return status === "error" ? (
      <RetryNotice
        title="공고를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        onRetry={reload}
      />
    ) : (
      <RetryNotice
        title="지금 볼 수 있는 공고가 없어요"
        description="새 공고가 올라오면 이곳에 모아 보여드려요."
        onRetry={reload}
        busy={status === "loading"}
      />
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between px-x4 pt-x5">
        <h2 className="t6-bold text-fg-neutral">최신 공고</h2>
        <span className="t4-regular text-fg-neutral-muted">등록 최신순</span>
      </div>
      <ul className="flex flex-col gap-x3 px-x4 pb-x4 pt-x3">
        {cards.map((card) => (
          <li key={card.key}>
            <JobCard card={card} />
          </li>
        ))}
        {status === "loading" && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
      </ul>

      {status === "error" && (
        <RetryNotice title="다음 공고를 불러오지 못했어요" description="네트워크를 확인하고 다시 시도해 주세요." onRetry={loadMore} />
      )}
      {cursor === null && (
        <p className="t4-regular px-x4 pb-x6 text-center text-fg-neutral-muted">모든 공고를 확인했어요</p>
      )}
      {/* 이 요소가 화면 가까이 오면 다음 페이지를 요청한다 */}
      <div ref={sentinel} aria-hidden="true" className="h-px" />
    </>
  );
}
