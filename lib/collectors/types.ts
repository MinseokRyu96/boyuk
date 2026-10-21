export type RawJob = {
  /** 출처 안의 공고 ID. 없으면 원문 URL의 해시 */
  sourceId: string;
  title: string;
  orgName?: string;
  region?: string;
  /** 'YYYY-MM-DD'. 상시채용이면 undefined */
  deadline?: string;
  url: string;
  /** 판별용 텍스트. 판별에만 쓰고 저장하지 않는다 */
  rawText?: string;
  /** API가 경력 구분을 줄 때만 */
  careerHint?: "new" | "any" | "experienced";
};

export interface Collector {
  source: string;
  /** 직장어린이집 운영업체 소스면 true */
  isWorkplace: boolean;
  /**
   * 아직 구현되지 않은 수집기면 false. 수집 엔드포인트가 501을 돌려주고 collector_runs에는 기록하지 않는다.
   * 생략하면 구현된 것으로 본다.
   */
  implemented?: boolean;
  fetchJobs(): Promise<RawJob[]>;
}
