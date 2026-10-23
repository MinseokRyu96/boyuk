"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "seed-design/ui/segmented-control";
import { readSavedDistricts, saveDistricts } from "@/lib/district-storage";
import type { SeoulGu } from "@/lib/districts";
import { FEED_SORTS, SORT_LABELS, isFeedSort, type FeedSort } from "@/lib/sort";
import { SOURCES, type SourceCode } from "@/lib/sources";
import type { FeedCounts, FeedPage } from "@/lib/types";
import { DistrictFilter } from "./DistrictFilter";
import { SkeletonCard } from "./FeedSkeleton";
import { JobCard } from "./JobCard";
import { MapView } from "./MapView";
import { RetryNotice } from "./RetryNotice";
import { SourceFilter } from "./SourceFilter";

type Status = "idle" | "loading" | "error";

/** 정렬에 따라 바뀌는 목록 제목 */
const HEADINGS: Record<FeedSort, string> = { new: "최신 공고", soon: "마감 임박 공고", late: "마감 늦은 공고" };

/** 서버에 보내는 보기 조건: 고른 구와 플랫폼, 정렬 */
type Query = { districts: readonly SeoulGu[]; sources: readonly SourceCode[]; sort: FeedSort };

async function requestPage(cursor: string | null, { districts, sources, sort }: Query): Promise<FeedPage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  for (const gu of districts) params.append("gu", gu);
  for (const code of sources) params.append("src", code);
  if (sort !== "new") params.set("sort", sort);
  const query = params.size > 0 ? `?${params}` : "";
  const res = await fetch(`/api/jobs${query}`);
  if (!res.ok) throw new Error(`공고 요청 실패 (${res.status})`);
  return res.json();
}

type View = "list" | "map";

type Props = {
  initial: FeedPage;
  counts: FeedCounts;
  /** 카카오맵 JavaScript 키. 없으면 지도 보기를 숨긴다 */
  mapKey: string | null;
};

/**
 * 공고 목록(또는 지도)과 서울 구별·플랫폼별 필터, 정렬(최신순·마감 임박순·마감 늦은순).
 * 끝에 가까워지면 다음 20건을 이어서 불러온다 (F1)
 */
export function Feed({ initial, counts, mapKey }: Props) {
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<SeoulGu[]>([]);
  const [sources, setSources] = useState<SourceCode[]>([]);
  const [sort, setSort] = useState<FeedSort>("new");
  const [cards, setCards] = useState(initial.cards);
  const [cursor, setCursor] = useState(initial.nextCursor);
  /** 필터가 걸린 목록에서 조건에 맞는 전체 공고 수. 첫 쪽을 받기 전에는 null */
  const [matchTotal, setMatchTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const busy = useRef(false);
  /** 구·플랫폼·정렬을 바꿀 때마다 올려서, 이전 선택으로 보낸 요청의 늦은 응답을 버린다 */
  const generation = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  /** 한 번 불러와 목록에 반영한다. mode가 replace면 목록을 새로 채우고, append면 뒤에 잇는다 */
  const run = useCallback(async (query: Query, from: string | null, mode: "append" | "replace") => {
    const mine = generation.current;
    busy.current = true;
    setStatus("loading");
    try {
      const page = await requestPage(from, query);
      if (mine !== generation.current) return;
      setCards((prev) => {
        if (mode === "replace") return page.cards;
        const seen = new Set(prev.map((card) => card.key));
        return [...prev, ...page.cards.filter((card) => !seen.has(card.key))];
      });
      setCursor(page.nextCursor);
      if (mode === "replace") setMatchTotal(page.total ?? null);
      setStatus("idle");
    } catch {
      if (mine === generation.current) setStatus("error");
    } finally {
      if (mine === generation.current) busy.current = false;
    }
  }, []);

  const loadMore = useCallback(() => {
    if (busy.current || !cursor) return;
    void run({ districts: selected, sources, sort }, cursor, "append");
  }, [cursor, selected, sources, sort, run]);

  /** 처음부터 다시 받는다. 빈 화면의 "다시 불러오기"가 쓴다 */
  const reload = useCallback(() => {
    if (busy.current) return;
    void run({ districts: selected, sources, sort }, null, "replace");
  }, [selected, sources, sort, run]);

  /**
   * 구·플랫폼·정렬을 바꾼다. 아무 필터도 없고 최신순이면 서버가 만든 첫 화면으로 돌아가고, 아니면 처음부터 새로 받는다.
   * 정렬마다 커서의 모양이 달라서 이전 목록의 커서를 이어 쓰지 않는다.
   */
  const changeView = useCallback(
    (query: Query) => {
      generation.current++;
      busy.current = false;
      setSelected([...query.districts]);
      setSources([...query.sources]);
      setSort(query.sort);
      setMatchTotal(null);
      window.scrollTo({ top: 0 });
      if (query.districts.length === 0 && query.sources.length === 0 && query.sort === "new") {
        setCards(initial.cards);
        setCursor(initial.nextCursor);
        setStatus("idle");
        return;
      }
      setCards([]);
      setCursor(null);
      void run(query, null, "replace");
    },
    [initial, run],
  );

  const changeDistricts = useCallback(
    (next: SeoulGu[]) => {
      saveDistricts(next);
      changeView({ districts: next, sources, sort });
    },
    [changeView, sources, sort],
  );

  const changeSources = useCallback((next: SourceCode[]) => changeView({ districts: selected, sources: next, sort }), [changeView, selected, sort]);

  const changeSort = useCallback(
    (next: string) => {
      if (isFeedSort(next)) changeView({ districts: selected, sources, sort: next });
    },
    [changeView, selected, sources],
  );

  /** 구와 플랫폼 필터를 모두 푼다 (정렬은 그대로) */
  const clearFilters = useCallback(() => {
    saveDistricts([]);
    changeView({ districts: [], sources: [], sort });
  }, [changeView, sort]);

  // 지난번에 고른 구가 있으면 열 때 다시 건다. 저장소는 브라우저에만 있어서 서버가 그린 첫 화면 뒤에 적용한다
  useEffect(() => {
    const saved = readSavedDistricts();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 값은 마운트한 뒤에야 읽을 수 있다
    if (saved.length > 0) changeView({ districts: saved, sources: [], sort: "new" });
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

  const filtered = selected.length > 0 || sources.length > 0;
  // 필터가 없으면 첫 화면에 실린 전체 건수, 있으면 서버가 센 조건에 맞는 건수(첫 쪽이 오기 전에는 비움)
  const shownCount = filtered ? matchTotal : counts.total;
  const failedWithoutCards = cards.length === 0 && status === "error";
  const empty = cards.length === 0 && cursor === null && status === "idle";
  const waiting = status === "loading";
  const summary = [selected.join(", "), sources.map((code) => SOURCES[code].label).join(", ")].filter(Boolean).join(" · ");

  return (
    <>
      <DistrictFilter counts={counts} selected={selected} onChange={changeDistricts} />
      <p className="sr-only" aria-live="polite">
        {`${summary ? `${summary} ` : ""}${SORT_LABELS[sort]} 공고${shownCount === null ? "" : ` ${shownCount}건`}`}
      </p>

      {mapKey && (
        <div className="px-x4 pt-x4">
          <SegmentedControl aria-label="보기 방식" value={view} onValueChange={(next) => setView(next === "map" ? "map" : "list")} style={{ width: "100%" }}>
            <SegmentedControlItem value="list">목록</SegmentedControlItem>
            <SegmentedControlItem value="map">지도</SegmentedControlItem>
          </SegmentedControl>
        </div>
      )}

      <SourceFilter counts={counts} selected={sources} onChange={changeSources} />

      {mapKey && view === "map" ? (
        <MapView appKey={mapKey} districts={selected} sources={sources} onShowList={() => setView("list")} />
      ) : (
        <>
          <div className="px-x4 pt-x3">
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
            <span className="t4-regular text-fg-neutral-muted">{shownCount === null ? " " : `${shownCount}건`}</span>
          </div>

          {failedWithoutCards ? (
            <RetryNotice title="공고를 불러오지 못했어요" description="잠시 후 다시 시도해 주세요." onRetry={reload} />
          ) : empty ? (
            filtered ? (
              <RetryNotice
                title="선택한 조건에 맞는 공고가 지금 없어요"
                description="다른 지역이나 플랫폼을 고르거나 전체 공고를 확인해 보세요."
                onRetry={clearFilters}
                actionLabel="필터 모두 풀기"
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
