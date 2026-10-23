/** 시·도 이름을 짧은 표기로 맞춘다 (PRD 예: "서울 강서구") */
const PROVINCES: Record<string, string> = {
  서울특별시: "서울",
  서울시: "서울",
  서울: "서울",
  부산광역시: "부산",
  부산: "부산",
  대구광역시: "대구",
  대구: "대구",
  인천광역시: "인천",
  인천: "인천",
  광주광역시: "광주",
  광주: "광주",
  대전광역시: "대전",
  대전: "대전",
  울산광역시: "울산",
  울산: "울산",
  세종특별자치시: "세종",
  세종시: "세종",
  세종: "세종",
  경기도: "경기",
  경기: "경기",
  강원특별자치도: "강원",
  강원도: "강원",
  강원: "강원",
  충청북도: "충북",
  충북: "충북",
  충청남도: "충남",
  충남: "충남",
  전북특별자치도: "전북",
  전라북도: "전북",
  전북: "전북",
  전라남도: "전남",
  전남: "전남",
  경상북도: "경북",
  경북: "경북",
  경상남도: "경남",
  경남: "경남",
  제주특별자치도: "제주",
  제주도: "제주",
  제주: "제주",
};

const ENTITIES: Record<string, string> = { "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&#39;": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(?:gt|lt|amp|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * 출처마다 다른 근무지 표기를 "시·도 시·군·구" 두 단계로 줄인다.
 *  - "서울 > 강서구"            → "서울 강서구"        (사람인)
 *  - "서울 > 관악구,서울 > 광진구" → "서울 관악구"        (여러 지역이면 첫 번째)
 *  - "서울특별시 강서구 화곡로 1"  → "서울 강서구"        (주소 형태)
 *  - "경기 > 성남시 분당구"       → "경기 성남시"
 * 알아볼 수 없으면 undefined.
 */
export function normalizeRegion(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const first = decodeEntities(raw).split(",")[0];
  const tokens = first
    .replace(/[>/·]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return undefined;

  const province = PROVINCES[tokens[0]];
  if (!province) return undefined;
  const district = tokens.slice(1).find((token) => /[시군구]$/.test(token));
  return district ? `${province} ${district}` : province;
}

/** 시·도 이름이 구 이름만으로는 정해지지 않는 곳(강서구는 부산에도, 중구는 여러 시에 있다)은 뺀 서울의 구 */
const SEOUL_DISTRICTS = [
  "강남구", "강동구", "강북구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구",
  "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중랑구",
];

/**
 * 지역 칸이 없는 출처(한솔·삼성·푸르니)의 제목·어린이집명에서 서울을 읽는다. 글자로 분명히 적혀 있을 때만 읽고 추측하지 않는다.
 *  - "서대문구 …"처럼 서울에만 있는 구 이름이 있으면 "서울 서대문구"
 *  - "서울"이 있으면 "서울" ("서울형어린이집"·"삼성서울병원어린이집" 포함. "서울대학교 시흥캠퍼스"처럼 다른 곳일 수도 있다)
 * 서울이 아닌 곳은 읽지 않는다(서울만 보여 주므로 필요 없다). 알 수 없으면 undefined.
 */
export function inferRegion(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const district = SEOUL_DISTRICTS.find((name) => text.includes(name));
  if (district) return `서울 ${district}`;
  return text.includes("서울") ? "서울" : undefined;
}

/** region("서울 강서구" 같은 짧은 표기)이 보여 줄 시·도에 속하는가. provinces가 비어 있으면 모두 속한다. 지역이 없으면 속하지 않는다 */
export function isInTargetRegion(region: string | undefined | null, provinces: readonly string[]): boolean {
  if (provinces.length === 0) return true;
  if (!region) return false;
  return provinces.includes(region.split(" ")[0]);
}
