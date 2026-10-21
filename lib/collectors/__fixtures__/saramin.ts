/*
 * [샘플] 사람인 채용공고 검색 API(GET /job-search)의 JSON 응답 모양 시험용 데이터. 실제 공고가 아니다.
 * 키 구조는 공식 명세(jobs > count/start/total/job[], position, company > detail > name, close-type,
 * experience-level, 오류 { code, message })를 따랐고, 값은 제가 가정한 것이다.
 * access-key를 발급받아 실제 응답을 받으면 이 파일을 실제 모양에 맞춰 고친다.
 */

const kst = (date: string) => String(Math.floor(Date.parse(`${date}+09:00`) / 1000));

const TRACKING = "&utm_source=job-search-api&utm_medium=api&utm_campaign=saramin-job-search-api";

export const saraminSearchFixture = {
  jobs: {
    count: 8,
    start: 0,
    total: "8",
    job: [
      {
        // 신입 가능 담임, 접수 마감일 있음
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000001${TRACKING}`,
        active: 1,
        company: { detail: { href: "https://www.saramin.co.kr/zf_user/company-info/view?csn=1", name: "해오름어린이집" } },
        position: {
          title: "[신입 가능] 만 1세반 담임교사 모집",
          industry: { code: "11", name: "어린이집" },
          location: { code: "101130", name: "서울 > 강서구" },
          "job-type": { code: "1", name: "정규직" },
          "job-mid-code": { code: "16", name: "교육" },
          "job-code": { code: "1601", name: "보육교사" },
          "experience-level": { code: 1, min: 0, max: 0, name: "신입" },
          "required-education-level": { code: "5", name: "대학교졸업(2,3년)이상" },
        },
        id: "27000001",
        "posting-timestamp": kst("2025-10-01T09:00:00"),
        "expiration-timestamp": kst("2025-10-31T23:59:59"),
        "close-type": { code: "1", name: "접수마감일" },
      },
      {
        // 경력 무관, 상시 채용 (expiration-timestamp는 형식상 들어 있지만 마감일이 아니다)
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000002${TRACKING}`,
        active: 1,
        company: { detail: { href: "https://www.saramin.co.kr/zf_user/company-info/view?csn=2", name: "푸르니 별빛어린이집" } },
        position: {
          title: "보육교사 채용 (경력 무관)",
          industry: { code: "11", name: "어린이집" },
          location: { code: "101140", name: "서울 > 마포구,서울 > 서대문구" },
          "job-code": { code: "1601", name: "보육교사" },
          "experience-level": { code: 0, min: 0, max: 0, name: "경력무관" },
        },
        id: "27000002",
        "expiration-timestamp": kst("2026-04-01T23:59:59"),
        "close-type": { code: "3", name: "상시" },
      },
      {
        // 경력자만
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000003${TRACKING}`,
        active: 1,
        company: { detail: { name: "달빛어린이집" } },
        position: {
          title: "담임교사 모집",
          industry: { code: "11", name: "어린이집" },
          location: { code: "102030", name: "경기 > 성남시 분당구" },
          "experience-level": { code: 2, min: 3, max: 0, name: "경력 3년↑" },
        },
        id: "27000003",
        "expiration-timestamp": kst("2025-11-15T23:59:59"),
        "close-type": { code: "1", name: "접수마감일" },
      },
      {
        // 학원 공고 (신입/경력): 담임교사지만 어린이집이 아니다
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000004${TRACKING}`,
        active: 1,
        company: { detail: { name: "스마일학원" } },
        position: {
          title: "초등부 담임교사 모집 (신입 가능)",
          industry: { code: "21", name: "학원" },
          location: { code: "101110", name: "서울 > 양천구" },
          "experience-level": { code: 3, min: 0, max: 0, name: "신입·경력" },
        },
        id: "27000004",
        "expiration-timestamp": kst("2025-11-01T23:59:59"),
        "close-type": { code: "1", name: "접수마감일" },
      },
      {
        // 이미 마감된 공고(active: 0)
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000005${TRACKING}`,
        active: 0,
        company: { detail: { name: "마감어린이집" } },
        position: { title: "신입 담임교사", industry: { name: "어린이집" }, "experience-level": { code: 1, name: "신입" } },
        id: "27000005",
        "close-type": { code: "1", name: "접수마감일" },
      },
      {
        // 위험한 링크
        url: "javascript:alert(1)",
        active: 1,
        company: { detail: { name: "위험링크어린이집" } },
        position: { title: "신입 담임교사", industry: { name: "어린이집" }, "experience-level": { code: 1, name: "신입" } },
        id: "27000006",
      },
      {
        // company 바로 아래에 name이 오는 모양 (XML 명세 표의 표기)
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000007${TRACKING}`,
        active: 1,
        company: { name: "A&B 어린이집" },
        position: {
          title: "신입 보육교사 모집",
          location: { name: "서울 &gt; 양천구" },
          "experience-level": { code: "1", name: "신입" },
        },
        id: "27000007",
        "expiration-timestamp": kst("2025-12-05T23:59:59"),
        "close-type": { code: "1", name: "접수마감일" },
      },
      {
        // 채용시 마감
        url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=27000008${TRACKING}`,
        active: 1,
        company: { detail: { name: "별빛어린이집" } },
        position: {
          title: "담임교사 채용",
          industry: { name: "어린이집" },
          "experience-level": { code: 3, name: "신입·경력" },
        },
        id: "27000008",
        "expiration-timestamp": kst("2026-01-01T23:59:59"),
        "close-type": { code: "2", name: "채용시" },
      },
    ],
  },
};

export const saraminFixtureBody = JSON.stringify(saraminSearchFixture);

/** 일일 호출 한도 초과 같은 오류 응답 (명세: { code, message }, 코드 4 = 일일 최대 요청 가능 횟수 초과) */
export const saraminQuotaErrorBody = JSON.stringify({ code: 4, message: "일일 최대 요청 가능 횟수를 초과했습니다." });
