import { UpdatedAgo } from "./UpdatedAgo";

type Props = {
  /** 로딩 중에는 비워 둔다 */
  freshness?: { updatedAt: string | null; serverNow: string };
};

/** 서비스명과 "N분 전 업데이트"만 둔 고정 헤더 (PRD 8장) */
export function Header({ freshness }: Props) {
  return (
    <header className="sticky top-0 z-10 border-b border-stroke-neutral-muted bg-bg-layer-default">
      <div className="flex min-h-14 items-baseline justify-between gap-x3 px-x4 py-x3">
        <h1 className="t6-bold tracking-tight text-fg-brand">보육공고</h1>
        <p className="t4-regular text-fg-neutral-muted" aria-live="polite">
          {freshness ? <UpdatedAgo {...freshness} /> : <span aria-hidden="true">&nbsp;</span>}
        </p>
      </div>
    </header>
  );
}
