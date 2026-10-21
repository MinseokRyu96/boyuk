const PATTERNS: RegExp[] = [
  // 2025-10-30, 2025.10.30, 2025/10/30, 2025년 10월 30일
  /(?<!\d)(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?!\d)/,
  // 20251030
  /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
  // 25-10-30, 25.10.30, 25/10/30 (두 자리 연도)
  /(?<!\d)(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/,
];

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= lastDay;
}

/**
 * 마감일·등록일 문자열에서 날짜를 'YYYY-MM-DD'로 꺼낸다. 날짜가 아니면 undefined.
 * 고용24 명세에는 날짜 형식 예시가 없어서 흔한 표기를 모두 받아들인다.
 * "채용시까지", "상시채용"처럼 날짜가 없는 문구는 undefined라서 마감일 없는 공고로 다뤄진다.
 */
export function parseLooseDate(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const value = text.trim();
  for (const pattern of PATTERNS) {
    const match = pattern.exec(value);
    if (!match) continue;
    let year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (match[1].length === 2) year += 2000;
    if (!isValidDate(year, month, day)) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return undefined;
}
