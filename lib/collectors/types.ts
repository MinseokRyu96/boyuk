export type RawJob = {
  /** 출처 안의 공고 ID, 없으면 원문 URL의 해시 */
  sourceId: string;
  title: string;
  orgName?: string;
  region?: string;
  /** 'YYYY-MM-DD'. 상시채용이면 undefined */
  deadline?: string;
  url: string;
  /** 신입·직무 판별용 텍스트. 판별에만 쓰고 저장하지 않는다 */
  rawText?: string;
  /** 어린이집 공고가 맞는지 확인용 텍스트(업종·직무 분류 등). 판별에만 쓰고 저장하지 않는다 */
  contextText?: string;
  /** API가 경력 구분을 줄 때만 */
  careerHint?: "new" | "any" | "experienced";
  /** 공고마다 직장어린이집인지 알 수 있을 때만. 없으면 수집기의 isWorkplace를 따른다 */
  isWorkplace?: boolean;
  /** 목록이 어린이집 유형(국공립·민간·가정·직장 …)을 줄 때만. 판별에만 쓰고 저장하지 않는다 */
  facilityType?: string;
};

/** 수집기 한 번의 결과 */
export type CollectResult = {
  jobs: RawJob[];
  /**
   * 원문 목록을 빠짐없이 가져왔으면 true.
   * 호출 한도나 페이지 상한 때문에 일부만 가져왔으면 false다.
   * false일 때는 "이번 목록에 없는 공고"가 정말 사라진 공고인지 알 수 없으므로 사라진 공고 처리를 하지 않는다.
   */
  complete: boolean;
};

export interface Collector {
  source: string;
  /** 직장어린이집 운영업체 소스면 true */
  isWorkplace: boolean;
  /**
   * 어린이집이 아닌 공고도 섞여 나오는 범용 채용 소스면 true.
   * true이면 제목·기관명·업종에 어린이집·보육·영유아가 있는 공고만 저장한다.
   * (예: "담임교사"로 검색하면 학원·학교 공고도 나온다)
   */
  needsChildcareContext?: boolean;
  /**
   * 아직 구현되지 않은 수집기면 false. 수집 엔드포인트가 501을 돌려주고 collector_runs에는 기록하지 않는다.
   * 생략하면 구현된 것으로 본다.
   */
  implemented?: boolean;
  /**
   * 보여 줄 지역(config.ts의 TARGET_PROVINCES) 밖이거나 지역을 몰라도 저장할 공고면 true를 돌려준다.
   * 신입·담임 판별은 그대로 거친다. 생략하면 지역 조건을 모든 공고에 건다 (예: 삼성은 정규직 담임 공고만 전국을 보여 준다)
   */
  keepOutsideRegion?: (job: RawJob) => boolean;
  fetchJobs(): Promise<CollectResult>;
}
