"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "seed-design/ui/segmented-control";
import { readSavedDistricts, saveDistricts } from "@/lib/district-storage";
import type { DistrictCounts, SeoulGu } from "@/lib/districts";
import { FEED_SORTS, SORT_LABELS, isFeedSort, type FeedSort } from "@/lib/sort";
import type { FeedPage } from "@/lib/types";
import { DistrictFilter } from "./DistrictFilter";
import { SkeletonCard } from "./FeedSkeleton";
import { JobCard } from "./JobCard";
import { MapView } from "./MapView";
import { RetryNotice } from "./RetryNotice";

type Status = "idle" | "loading" | "error";

/** 정렬에 따라 바뀌는 목록 제목 */
const HEADINGS: Record<FeedSort, string> = { new: "최신 공고", soon: "마감 임박 공고", late: "마감 늦은 공고" };

async function requestPage(cursor: string | null, districts: readonly SeoulGu[], sort: FeedSort): Promise<FeedPage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  for (const gu of districts) params.append("gu", gu);
  if (sort !== "new") params.set("sort", sort);
  const query = params.size > 0 ? `?${params}` : "";
  const res = await fetch(`/api/jobs${query}`);
  if (!res.ok) throw new Error(`공고 요청 실패 (${res.status})`);
  return res.json();
}

type View = "list" | "map";

type Props = {
  initial: FeedPage;
  districtCounts: DistrictCounts;
  /** 카카오맵 JavaScript 키. 없으면 지도 보기를 숨긴다 */
  mapKey: string | null;
};

/** 공고 목록(또는 지도)과 서울 구별 필터, 정렬(최신순·마감 임박순·마감 늦은순). 끝에 가까워지면 다음 20건을 이어서 불러온다 (F1) */
export function Feed({ initial, districtCounts, mapKey }: Props) {
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<SeoulGu[]>([]);
  const [sort, setSort] = useState<FeedSort>("new");
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [status, setStatus] = useState<Status>("idle");
  const busy = useRef(false);
  /** 구나 정렬을 바꿀 때마다 올려서, 이전 선택으로 보낸 요청의 늦은 응답을 버린다 */
  const generation = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  /** 한 번 불러와 목록에 반영한다. mode가 replace면 목록을 새로 채우고, append면 뒤에 잇는다 */
  const run = useCallback(async (districts: readonly SeoulGu[], order: FeedSort, from: string | null, mode: "append" | "replace") => {
    const mine = generation.current;
    busy.current = true;
    setStatus("loading");
    try {
      const page = await requestPage(from, districts, order);
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
    void run(selected, sort, cursor, "append");
  }, [cursor, selected, sort, run]);

  /** 처음부터 다시 받는다. 빈 화면의 "다시 불러오기"가 쓴다 */
  const reload = useCallback(() => {
    if (busy.current) return;
    void run(selected, sort, null, "replace");
  }, [selected, sort, run]);

  /**
   * 구나 정렬을 바꾼다. 구가 없고 최신순이면 서버가 만든 첫 화면으로 돌아가고, 아니면 처음부터 새로 받는다.
   * 정렬마다 커서의 모양이 달라서 이전 목록의 커서를 이어 쓰지 않는다.
   */
  const changeView = useCallback(
    (districts: SeoulGu[], order: FeedSort) => {
      generation.current++;
      busy.current = false;
      setSelected(districts);
      setSort(order);
      window.scrollTo({ top: 0 });
      if (districts.length === 0 && order === "new") {
        setCards(initial.cards);
        setCursor(initial.nextCursor);
        setStatus("idle");
        return;
      }
      setCards([]);
      setCursor(null);
      void run(districts, order, null, "replace");
    },
    [initial, run],
  );

  const changeDistricts = useCallback(
    (next: SeoulGu[]) => {
      saveDistricts(next);
      changeView(next, sort);
    },
    [changeView, sort],
  );

  const changeSort = useCallback((next: string) => {
    if (isFeedSort(next)) changeView(selected, next);
  }, [changeView, selected]);

  // 지난번에 고른 구가 있으면 열 때 다시 건다. 저장소는 브라우저에만 있어서 서버가 그린 첫 화면 뒤에 적용한다
  useEffect(() => {
    const saved = readSavedDistricts();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 값은 마운트한 뒤에야 읽을 수 있다
    if (saved.length > 0) changeView(saved, "new");
  }, [changeView]);

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
  const shownCount = filtered ? selected.reduce((sum, gu) => sum + (districtCounts.byDistrict[gu] ?? 0), 0) : districtCounts.total;
  const failedWithoutCards = cards.length === 0 && status === "error";
  const empty = cards.length === 0 && cursor === null && status === "idle";
  // 구 필터가 훑는 상한에 걸리면 비어 있어도 이어 읽을 커서가 있다. 그동안은 불러오는 중으로 보여 준다
  const waiting = status === "loading" || (cards.length === 0 && cursor !== null);

  return (
    <>
      <DistrictFilter counts={districtCounts} selected={selected} onChange={changeDistricts} />
      <p className="sr-only" aria-live="polite">
        {`${filtered ? `${selected.join(", ")} ` : ""}${SORT_LABELS[sort]} 공고 ${shownCount}건`}
      </p>

      {mapKey && (
        <div className="px-x4 pt-x4">
          <SegmentedControl aria-label="보기 방식" value={view} onValueChange={(next) => setView(next === "map" ? "map" : "list")} style={{ width: "100%" }}>
            <SegmentedControlItem value="list">목록</SegmentedControlItem>
            <SegmentedControlItem value="map">지도</SegmentedControlItem>
          </SegmentedControl>
        </div>
      )}

      {mapKey && view === "map" ? (
        <MapView appKey={mapKey} districts={selected} onShowList={() => setView("list")} />
      ) : (
        <>
          <div className="px-x4 pt-x4">
            <SegmentedControl aria-label="공고 정렬" value={sort} onValueChange={changeSort} style={{ width: "100%" }}>
              {FEED_SORTS.map((order) => (
                <SegmentedControlItem key={order} value={order}>
                  {SORT_LABELS[order]}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>

          <div className="flex items-baseline justify-between px-x4 pt-x5">
            <h2 className="t6-bold text-fg-neutral">{HEADINGS[sort]}</h2>
            <span className="t4-regular text-fg-neutral-muted">{shownCount}건</span>
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
      )}
    </>
  );
}
