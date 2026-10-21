const KST = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

const kstDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 한국 시간 기준 오늘 날짜 'YYYY-MM-DD' */
export function kstToday(now: Date): string {
  return kstDateFormat.format(now);
}

function dateOnlyToUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 마감일까지 남은 날수. 오늘이 마감이면 0, 지났으면 음수 */
export function daysUntil(deadline: string, now: Date): number {
  return Math.round((dateOnlyToUtcMs(deadline) - dateOnlyToUtcMs(kstToday(now))) / DAY_MS);
}

/** D-3 이하는 강조한다 (PRD 8장) */
const URGENT_DAYS = 3;

/** today: 오늘 마감, soon: D-3 이하, normal: 그 외, open: 마감일 없는 상시채용 */
export type DDayLevel = "today" | "soon" | "normal" | "open";

export function dDay(deadline: string | null, now: Date): { label: string; level: DDayLevel } {
  if (!deadline) return { label: "상시", level: "open" };
  const days = daysUntil(deadline, now);
  if (days < 0) return { label: "마감", level: "normal" };
  if (days === 0) return { label: "오늘마감", level: "today" };
  return { label: `D-${days}`, level: days <= URGENT_DAYS ? "soon" : "normal" };
}

/** 최초 수집 후 24시간 이내면 NEW (PRD F7) */
export function isNewPosting(firstSeenAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(firstSeenAt).getTime();
  return age >= 0 && age < DAY_MS;
}

/** "방금 전", "12분 전", "3시간 전", "2일 전" */
export function relativeTime(iso: string, now: Date): string {
  const diffMin = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
