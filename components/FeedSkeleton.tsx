"use client";

import { Skeleton } from "@seed-design/react";

/** 불러오는 동안 보여주는 카드 모양 자리표시 (PRD 8장). 실제 카드와 같은 뼈대라 내용이 채워질 때 화면이 흔들리지 않는다 */
export function SkeletonCard() {
  return (
    <li aria-hidden="true" className="rounded-r4 border border-stroke-neutral-muted bg-bg-layer-default p-x4">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-x6">
          <Skeleton radius="8" width="120px" height="lineHeight.t4" />
          <Skeleton radius="8" width="x12" height="x6" />
        </div>
        <Skeleton radius="8" width="full" height="lineHeight.t5" className="mt-x2" />
        <Skeleton radius="8" width="120px" height="lineHeight.t4" className="mt-x2" />
        <div className="mt-x3 flex gap-x2">
          <Skeleton radius="8" width="x14" height="x6" />
          <Skeleton radius="8" width="x12" height="x6" />
        </div>
      </div>
    </li>
  );
}

export function FeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="공고를 불러오는 중이에요">
      <div className="flex items-baseline justify-between px-x4 pt-x5" aria-hidden="true">
        <span className="t6-bold text-fg-neutral">최신 공고</span>
        <span className="t4-regular text-fg-neutral-muted">등록 최신순</span>
      </div>
      <ul className="flex flex-col gap-x3 px-x4 pb-x4 pt-x3">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </ul>
    </div>
  );
}
