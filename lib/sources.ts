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

/** 알려진 수집 출처 코드인가 */
export function isSourceCode(value: string): value is SourceCode {
  return Object.hasOwn(SOURCES, value);
}

/**
 * 주소의 src 파라미터들(같은 이름을 여러 번 쓴다: ?src=samsung&src=hansol)을 검사한다.
 * 알 수 없는 출처가 하나라도 있으면 null, 아니면 중복을 뺀 목록(비어 있을 수 있다).
 */
export function parseSources(values: readonly string[]): SourceCode[] | null {
  const result = new Set<SourceCode>();
  for (const value of values) {
    if (!isSourceCode(value)) return null;
    result.add(value);
  }
  return [...result];
}

/**
 * 지금 크론(vercel.json)이 수집하는 출처. 플랫폼 필터에서는 공고가 0건이어도 칩을 보여 줘서
 * "수집은 하는데 지금 공고가 없는 것"과 "수집하지 않는 것"을 구분한다. 크론을 바꾸면 이 목록도 맞춘다.
 */
export const ACTIVE_SOURCES: readonly SourceCode[] = ["seoul_center", "hansol", "purunee", "samsung"];

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
