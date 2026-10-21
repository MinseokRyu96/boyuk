import type { DDayLevel } from "@/lib/time";
import type { FeedCard } from "@/lib/types";
import { Avatar } from "seed-design/ui/avatar";
import { Badge } from "seed-design/ui/badge";
import { TagGroupItem, TagGroupRoot } from "seed-design/ui/tag-group";

/**
 * 마감이 가까울수록 진하게: 오늘마감은 채운 붉은색, D-3 이하는 옅은 붉은색, 나머지는 회색.
 * SEED의 critical solid(red-700)는 흰 글자와 3.76:1이라 PRD 기준(4.5:1)에 못 미친다.
 * 오늘마감만 한 단계 진한 red-800(5.68:1)으로 덮어쓴다. Tailwind 클래스가 SEED 컴포넌트보다 우선하는 설정(next.config.ts) 덕에 가능하다.
 */
const DDAY_BADGE = {
  today: { tone: "critical", variant: "solid", extra: "bg-palette-red-800" },
  soon: { tone: "critical", variant: "weak", extra: "" },
  normal: { tone: "neutral", variant: "weak", extra: "" },
  open: { tone: "neutral", variant: "weak", extra: "" },
} as const satisfies Record<
  DDayLevel,
  { tone: "critical" | "neutral"; variant: "solid" | "weak"; extra: string }
>;

/** 카드 전체가 하나의 링크다. 원문은 새 탭에서 열려 돌아오면 스크롤 위치가 유지된다 (F3) */
export function JobCard({ card }: { card: FeedCard }) {
  const { orgName, initial, title, region, dDay, sources, isNew, isWorkplace, url } = card;
  const { extra, ...ddayBadge } = DDAY_BADGE[dDay.level];

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 gap-x3 rounded-r4 border border-stroke-neutral-muted bg-bg-layer-default p-x4 transition-colors active:bg-bg-layer-default-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-brand-solid"
    >
      <Avatar size="48" fallback={initial} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-x2">
          <p className="t4-medium min-w-0 flex-1 truncate pt-x1 text-fg-neutral-muted">{orgName}</p>
          <Badge size="large" {...ddayBadge} className={`shrink-0 ${extra}`}>
            {dDay.level !== "open" && <span className="sr-only">마감 </span>}
            {dDay.label}
          </Badge>
        </div>

        <h3 className="t5-bold mt-x1 line-clamp-2 text-fg-neutral">{title}</h3>
        {region && (
          <TagGroupRoot size="t4" tone="neutral" className="mt-x1">
            <TagGroupItem label={region} />
          </TagGroupRoot>
        )}

        <div className="mt-x3 flex flex-wrap gap-x2">
          {sources.map((source) => (
            <Badge key={source.code} size="large" tone="neutral" variant="weak">
              {source.label}
            </Badge>
          ))}
          {isNew && (
            <Badge size="large" tone="brand" variant="weak">
              NEW
            </Badge>
          )}
          {isWorkplace && (
            <Badge size="large" tone="informative" variant="weak">
              직장
            </Badge>
          )}
        </div>

        <span className="sr-only">원문 페이지가 새 탭에서 열려요</span>
      </div>
    </a>
  );
}
