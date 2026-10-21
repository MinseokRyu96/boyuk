/** 불러오는 동안 보여주는 카드 모양 자리표시 (PRD 8장). 실제 카드와 같은 뼈대라 내용이 채워질 때 화면이 흔들리지 않는다 */
export function SkeletonCard() {
  return (
    <li aria-hidden="true" className="flex gap-3 rounded-2xl border border-line bg-card p-4">
      <div className="size-12 shrink-0 animate-pulse rounded-xl bg-line motion-reduce:animate-none" />
      <div className="min-w-0 flex-1 animate-pulse space-y-2.5 motion-reduce:animate-none">
        <div className="flex justify-between gap-6">
          <div className="h-4 w-2/5 rounded bg-line" />
          <div className="h-5 w-12 rounded-md bg-line" />
        </div>
        <div className="h-4 w-11/12 rounded bg-line" />
        <div className="h-4 w-1/3 rounded bg-line" />
        <div className="flex gap-1.5 pt-0.5">
          <div className="h-5 w-12 rounded-md bg-line" />
          <div className="h-5 w-10 rounded-md bg-line" />
        </div>
      </div>
    </li>
  );
}

export function FeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="공고를 불러오는 중이에요">
      <div className="flex items-baseline justify-between px-4 pt-5" aria-hidden="true">
        <span className="text-[18px] font-extrabold tracking-tight text-ink">최신 공고</span>
        <span className="text-[14px] text-ink-soft">등록 최신순</span>
      </div>
      <ul className="flex flex-col gap-3 px-4 pb-4 pt-3">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </ul>
    </div>
  );
}
