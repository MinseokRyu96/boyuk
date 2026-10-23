"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readSavedDistricts, saveDistricts } from "@/lib/district-storage";
import type { DistrictCounts, SeoulGu } from "@/lib/districts";
import type { FeedPage } from "@/lib/types";
import { DistrictFilter } from "./DistrictFilter";
import { SkeletonCard } from "./FeedSkeleton";
import { JobCard } from "./JobCard";
import { RetryNotice } from "./RetryNotice";

type Status = "idle" | "loading" | "error";

async function requestPage(cursor: string | null, districts: readonly SeoulGu[]): Promise<FeedPage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  for (const gu of districts) params.append("gu", gu);
  const query = params.size > 0 ? `?${params}` : "";
  const res = await fetch(`/api/jobs${query}`);
  if (!res.ok) throw new Error(`공고 요청 실패 (${res.status})`);
  return res.json();
}

/** 최신순 공고 목록과 서울 구별 필터. 끝에 가까워지면 다음 20건을 이어서 불러온다 (F1) */
export function Feed({ initial, districtCounts }: { initial: FeedPage; districtCounts: DistrictCounts }) {
  const [selected, setSelected] = useState<SeoulGu[]>([]);
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [status, setStatus] = useState<Status>("idle");
  const busy = useRef(false);
  /** 구를 바꿀 때마다 올려서, 이전 선택으로 보낸 요청의 늦은 응답을 버린다 */
  const generation = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  /** 한 번 불러와 목록에 반영한다. mode가 replace면 목록을 새로 채우고, append면 뒤에 잇는다 */
  const run = useCallback(async (districts: readonly SeoulGu[], from: string | null, mode: "append" | "replace") => {
    const mine = generation.current;
    busy.current = true;
    setStatus("loading");
    try {
      const page = await requestPage(from, districts);
      if (mine !== generation.current) return;
      setCards((prev) => {
        if (mode === "replace") return page.cards;
        const seen = new Set(prev.map((card) => card.key));
        return [...prev, ...page.cards.filter((card) => !seen.has(card.key))];
      });
      setCursor(page.nextCursor);
      setStatus("idle");
    } catch {
      if (mine === generation.current) setStatus("error");
    } finally {
      if (mine === generation.current) busy.current = false;
    }
  }, []);

  const loadMore = useCallback(() => {
    if (busy.current || !cursor) return;
    void run(selected, cursor, "append");
  }, [cursor, selected, run]);

  /** 처음부터 다시 받는다. 빈 화면의 "다시 불러오기"가 쓴다 */
  const reload = useCallback(() => {
    if (busy.current) return;
    void run(selected, null, "replace");
  }, [selected, run]);

  /** 구를 바꾼다. 비우면 서버가 만든 첫 화면으로 돌아가고, 아니면 그 구의 공고를 처음부터 받는다 */
  const changeDistricts = useCallback(
    (next: SeoulGu[]) => {
      generation.current++;
      busy.current = false;
      setSelected(next);
      saveDistricts(next);
      window.scrollTo({ top: 0 });
      if (next.length === 0) {
        setCards(initial.cards);
        setCursor(initial.nextCursor);
        setStatus("idle");
        return;
      }
      setCards([]);
      setCursor(null);
      void run(next, null, "replace");
    },
    [initial, run],
  );

  // 지난번에 고른 구가 있으면 열 때 다시 건다. 저장소는 브라우저에만 있어서 서버가 그린 첫 화면 뒤에 적용한다
  useEffect(() => {
    const saved = readSavedDistricts();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 값은 마운트한 뒤에야 읽을 수 있다
    if (saved.length > 0) changeDistricts(saved);
  }, [changeDistricts]);

  // 목록 끝 근처에 닿으면 다음 페이지를 요청한다. 오류가 나면 관찰을 멈춰 같은 요청이 반복되지 않게 한다.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || status !== "idle") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, status, loadMore]);

  const filtered = selected.length > 0;
  const filteredCount = selected.reduce((sum, gu) => sum + (districtCounts.byDistrict[gu] ?? 0), 0);
  const failedWithoutCards = cards.length === 0 && status === "error";
  const empty = cards.length === 0 && cursor === null && status === "idle";
  // 구 필터가 훑는 상한에 걸리면 비어 있어도 이어 읽을 커서가 있다. 그동안은 불러오는 중으로 보여 준다
  const waiting = status === "loading" || (cards.length === 0 && cursor !== null);

  return (
    <>
      <DistrictFilter counts={districtCounts} selected={selected} onChange={changeDistricts} />
      <p className="sr-only" aria-live="polite">
        {filtered ? `${selected.join(", ")} 공고 ${filteredCount}건` : ""}
      </p>

      <div className="flex items-baseline justify-between px-x4 pt-x5">
        <h2 className="t6-bold text-fg-neutral">최신 공고</h2>
        <span className="t4-regular text-fg-neutral-muted">{filtered ? `${filteredCount}건 · 등록 최신순` : "등록 최신순"}</span>
      </div>

      {failedWithoutCards ? (
        <RetryNotice title="공고를 불러오지 못했어요" description="잠시 후 다시 시도해 주세요." onRetry={reload} />
      ) : empty ? (
        filtered ? (
          <RetryNotice
            title="선택한 지역에 지금 공고가 없어요"
            description="다른 지역을 고르거나 전체 공고를 확인해 보세요."
            onRetry={() => changeDistricts([])}
            actionLabel="전체 공고 보기"
          />
        ) : (
          <RetryNotice
            title="지금 볼 수 있는 공고가 없어요"
            description="새 공고가 올라오면 이곳에 모아 보여드려요."
            onRetry={reload}
          />
        )
      ) : (
        <>
          <ul className="flex flex-col gap-x3 px-x4 pb-x4 pt-x3">
            {cards.map((card) => (
              <li key={card.key}>
                <JobCard card={card} />
              </li>
            ))}
            {waiting && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
          </ul>

          {status === "error" && (
            <RetryNotice title="다음 공고를 불러오지 못했어요" description="네트워크를 확인하고 다시 시도해 주세요." onRetry={loadMore} />
          )}
          {cursor === null && cards.length > 0 && (
            <p className="t4-regular px-x4 pb-x6 text-center text-fg-neutral-muted">모든 공고를 확인했어요</p>
          )}
          {/* 이 요소가 화면 가까이 오면 다음 페이지를 요청한다 */}
          <div ref={sentinel} aria-hidden="true" className="h-px" />
        </>
      )}
    </>
  );
}
