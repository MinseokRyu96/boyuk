import type { DDayLevel } from "@/lib/time";
import type { FeedCard } from "@/lib/types";

const chip = "inline-flex items-center rounded-md px-2 py-0.5 text-[13px] font-semibold leading-5";

/** lib/avatar.ts의 AVATAR_TONE_COUNT와 개수를 맞춘다 */
const AVATAR_TONES = [
  "bg-tone-sky-bg text-tone-sky-ink",
  "bg-tone-violet-bg text-tone-violet-ink",
  "bg-tone-lime-bg text-tone-lime-ink",
  "bg-tone-slate-bg text-tone-slate-ink",
  "bg-tone-mocha-bg text-tone-mocha-ink",
];

/** 마감이 가까울수록 진하게: 오늘마감은 채운 색, D-3 이하는 옅은 붉은색, 나머지는 회색 */
const DDAY_STYLE: Record<DDayLevel, string> = {
  today: "bg-urgent text-white",
  soon: "bg-urgent-soft text-urgent",
  normal: "bg-chip text-ink-soft",
  open: "bg-chip text-ink-soft",
};

/** 카드 전체가 하나의 링크다. 원문은 새 탭에서 열려 돌아오면 스크롤 위치가 유지된다 (F3) */
export function JobCard({ card }: { card: FeedCard }) {
  const { orgName, avatar, title, region, dDay, sources, isNew, isWorkplace, url } = card;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 gap-3 rounded-2xl border border-line bg-card p-4 transition-colors active:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        aria-hidden="true"
        className={`grid size-12 shrink-0 place-items-center rounded-xl text-[20px] font-extrabold ${AVATAR_TONES[avatar.tone % AVATAR_TONES.length]}`}
      >
        {avatar.initial}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate pt-0.5 text-[14px] font-semibold text-ink-soft">{orgName}</p>
          <span className={`${chip} shrink-0 ${DDAY_STYLE[dDay.level]}`}>
            {dDay.level !== "open" && <span className="sr-only">마감 </span>}
            {dDay.label}
          </span>
        </div>

        <h3 className="mt-1 line-clamp-2 text-[16px] font-bold leading-snug text-ink">{title}</h3>
        {region && <p className="mt-1 text-[14px] text-ink-soft">{region}</p>}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <span key={source.code} className={`${chip} bg-brand-soft text-brand`}>
              {source.label}
            </span>
          ))}
          {isNew && <span className={`${chip} bg-new-bg text-new-ink`}>NEW</span>}
          {isWorkplace && <span className={`${chip} bg-workplace-bg text-workplace-ink`}>직장</span>}
        </div>

        <span className="sr-only">원문 페이지가 새 탭에서 열려요</span>
      </div>
    </a>
  );
}
