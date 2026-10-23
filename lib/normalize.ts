import type { RawJob } from "./collectors/types";

/*
 * 신입·담임 판별 (PRD 6장). 원칙은 "애매하면 저장한다"이다.
 * 구직자에게는 놓치는 공고보다 불필요한 공고 한 건이 덜 해롭기 때문이다.
 */

const NEWBIE = /신입|경력\s*(무관|불문)/;
/** "신입 불가"처럼 신입 표현이 있어도 신입을 받지 않는다는 뜻인 경우 */
const NEWBIE_DENIED = /신입\s*(지원\s*)?(불가|제외|사절)/g;

/** 경력자만 찾는 표현. "경력자 우대"처럼 필수가 아닌 표현은 걸러내지 않는다 */
const EXPERIENCED_ONLY = [
  /경력\s*\d+\s*년\s*(이상|↑)(?!\s*(자\s*)?우대)/,
  /\d+\s*년\s*이상\s*(의\s*)?경력(?!\s*(자\s*)?우대)/,
  /경력\s*직/,
  /경력\s*자(?!\s*우대)/,
];

/** "비담임"은 담임이 아니라는 뜻이라 담임으로 세지 않는다 */
const HOMEROOM = /(?<!비\s*)담임/;
const TEACHER = /담임|보육\s*교사/;
/** 담임이 아닌 보조·연장반·대체·비담임 교사. PRD 미해결 질문에 따라 현재는 제외한다 */
const ASSISTANT = /보조\s*[&·/,]?\s*(교사|선생|연장)|대체\s*(보육\s*)?(교사|선생)|비\s*담임|연장\s*(보육\s*)?(반|전담|전임|겸직|교사|선생)|야간\s*연장|시간제/;
const OTHER_DUTY = /원장|조리|영양사|간호|운전|사무|청소/;
/**
 * 담임·보육교사라고 못 박지는 않았지만 교사를 구하는 글.
 * "2027학년도 정기 공개채용"·"교직원 공채"처럼 직무 없이 공채만 적은 글도 어린이집 게시판에서는 주로 교사를 뽑는 것이라 넣는다
 * (원장·조리 같은 다른 직무가 제목에 있으면 OTHER_DUTY가 먼저 거른다)
 */
const GENERIC_TEACHER = /교사|선생님|보육|교직원|공개\s*채용|공채|정기\s*채용/;

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function matchesCareer(job: RawJob, text: string): boolean {
  const searchable = text.replace(NEWBIE_DENIED, " ");
  const newbie = NEWBIE.test(searchable);
  if (job.careerHint === "new" || job.careerHint === "any") return true;
  if (newbie) return true;
  if (job.careerHint === "experienced") return false;
  return !EXPERIENCED_ONLY.some((pattern) => pattern.test(searchable));
}

function matchesDuty(title: string, rawText: string): boolean {
  if (ASSISTANT.test(title) && !HOMEROOM.test(title)) return false;
  if (TEACHER.test(title)) return true;
  if (OTHER_DUTY.test(title)) return false;
  if (TEACHER.test(rawText)) return true;
  return GENERIC_TEACHER.test(title) || GENERIC_TEACHER.test(rawText);
}

/** 신입이면서 담임·보육교사 직무인 공고인가 */
export function isTarget(job: RawJob): boolean {
  const title = clean(job.title);
  const rawText = clean(job.rawText);
  return matchesCareer(job, `${title} ${rawText}`) && matchesDuty(title, rawText);
}

/** 어린이집 맥락을 알려 주는 단어. "유치원"과 "학원"은 일부러 넣지 않았다 (PRD 대상은 어린이집이다) */
const CHILDCARE = /어린이집|보육|영유아/;

/**
 * 어린이집 공고가 맞는가. 범용 채용 소스(고용24·사람인)는 학원·학교의 "담임교사" 공고도 함께 주므로
 * 제목·기관명·업종·직무 분류 중 어디에든 어린이집·보육·영유아가 있어야 통과시킨다.
 */
export function isChildcareContext(job: RawJob): boolean {
  return CHILDCARE.test([job.title, job.orgName, job.contextText, job.rawText].filter(Boolean).join(" "));
}
