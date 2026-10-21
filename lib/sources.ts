/** 수집 출처. jobs.source 컬럼에 들어가는 코드다. */
export const SOURCES = {
  work24: { label: "고용24", isWorkplace: false },
  saramin: { label: "사람인", isWorkplace: false },
  seoul_center: { label: "서울시센터", isWorkplace: false },
  moamam: { label: "모아맘", isWorkplace: true },
  purunee: { label: "푸르니", isWorkplace: true },
  hansol: { label: "한솔", isWorkplace: true },
  samsung: { label: "삼성", isWorkplace: true },
} as const;

export type SourceCode = keyof typeof SOURCES;

/** 수집 엔드포인트 /api/cron/[source]에 쓰는 주소 값과 출처 코드의 대응 */
export const CRON_SLUGS: Record<string, SourceCode> = {
  work24: "work24",
  saramin: "saramin",
  "seoul-center": "seoul_center",
  moamam: "moamam",
  purunee: "purunee",
  hansol: "hansol",
  samsung: "samsung",
};

export function sourceLabel(code: string): string {
  return code in SOURCES ? SOURCES[code as SourceCode].label : code;
}

/** 뱃지를 보여줄 때의 고정 순서 (API → 센터 → 직장어린이집 업체) */
const SOURCE_ORDER = Object.keys(SOURCES);

export function sortSources(codes: string[]): string[] {
  const rank = (code: string) => {
    const i = SOURCE_ORDER.indexOf(code);
    return i === -1 ? SOURCE_ORDER.length : i;
  };
  return [...codes].sort((a, b) => rank(a) - rank(b));
}
