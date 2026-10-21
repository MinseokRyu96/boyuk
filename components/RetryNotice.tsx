type Props = {
  title: string;
  description: string;
  onRetry: () => void;
  busy?: boolean;
};

/** 공고가 없거나 불러오기에 실패했을 때의 안내와 "다시 불러오기" 버튼 (F10) */
export function RetryNotice({ title, description, onRetry, busy = false }: Props) {
  return (
    <div role="alert" className="mx-4 my-6 rounded-2xl border border-line bg-card px-5 py-8 text-center">
      <p className="text-[16px] font-bold text-ink">{title}</p>
      <p className="mt-1.5 text-[14px] text-ink-soft">{description}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {busy ? "불러오는 중…" : "다시 불러오기"}
      </button>
    </div>
  );
}
