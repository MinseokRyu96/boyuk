import { HttpError, type HttpClient } from "../collectors/http";
import { districtOf } from "../districts";

/*
 * 카카오 로컬 API "키워드로 장소 검색"으로 어린이집의 위치를 찾는다.
 *   GET https://dapi.kakao.com/v2/local/search/keyword.json?query=…   헤더 Authorization: KakaoAK {REST API 키}
 *   응답 documents[]: place_name, category_name, address_name, road_address_name, x(경도), y(위도)
 * (공식 문서: https://developers.kakao.com/docs/ko/local/dev-guide — x·y는 문자열이다)
 *
 * 공고에는 어린이집 이름과 구("서울 마포구")만 있어서 "마포구 가나다어린이집"으로 검색하고,
 * 결과가 정말 그 어린이집인지는 우리가 따로 확인한다 (같은 이름의 다른 지역 어린이집, 전혀 다른 가게가 섞여 나온다).
 * 카카오는 검색어의 모든 낱말이 맞아야 결과를 주는 듯해서, 이름 표기가 조금만 달라도(예: "서울형"이 붙은 이름, 띄어쓰기) 0건이 나온다.
 * 그래서 못 찾으면 이름의 알맹이("가나다")로 검색어를 바꿔 다시 찾는다. 2026-10-24에 실제 공고 45곳으로 시험했을 때
 * 처음 검색만으로 21곳, 변형까지 쓰면 32곳을 찾았다. 나머지는 카카오 지도에 없는 어린이집이다.
 * 이름이 비슷하지 않거나 주소가 해당 구가 아니거나, 장소가 어린이집이 아니면 위치를 못 찾은 것으로 한다.
 * 틀린 곳에 핀을 꽂는 것보다 빠지는 편이 낫다. (실제로 "한강로어린이집"이 "한강로동 땡땡거리"로, "한가람어린이집"이
 * "한가람고등학교"로, "파랑새어린이집"이 "도예공방파랑새"로 잡히는 일이 있어서 카테고리 조건을 뒀다.)
 */

export const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";

export type KakaoDocument = {
  id?: string;
  place_name: string;
  category_name?: string;
  /** 카카오 카테고리 그룹 코드. PS3은 어린이집·유치원이다 */
  category_group_code?: string;
  address_name?: string;
  road_address_name?: string;
  /** 경도(문자열) */
  x: string;
  /** 위도(문자열) */
  y: string;
};

export type PlaceMatch = {
  lat: number;
  lng: number;
  /** "장소명 · 주소". 어떤 곳으로 찾았는지 사람이 확인할 수 있게 DB에 남긴다 */
  label: string;
};

/** 어린이집 위치를 찾는 함수. 찾지 못하면 null */
export type PlaceFinder = (orgName: string, region: string | null) => Promise<PlaceMatch | null>;

/** 키·권한·한도 문제라서 다른 어린이집도 모두 실패할 오류. 호출하는 쪽은 나머지를 멈춘다 */
export class KakaoApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "KakaoApiError";
  }
}

/** 이름 비교에서 무시할 표기: 설립 형태·법인 표기. 같은 어린이집이 출처마다 다르게 적히기 때문이다 */
const NOISE = /사회복지법인|학교법인|재단법인|\(재\)|\(사\)|\(유\)|\(주\)|㈜|국공립|구립|시립|직장|서울형|민간|가정|협동|법인/g;

/** 어린이집 이름의 알맹이: 공백·기호·설립 형태와 끝의 "어린이집"을 뗀 글자 */
export function placeKey(name: string): string {
  // 법인 표기에는 괄호가 들어 있어서("(재)") 기호를 지우기 전에 먼저 뗀다
  return name.replace(NOISE, "").replace(/[\s()[\]{}·・.,/\-_+&!'"~]/g, "").replace(/어린이집$/, "");
}

/**
 * 두 이름이 같은 어린이집을 가리키는가. 알맹이가 같거나, 한쪽이 다른 쪽을 포함하되 짧은 쪽이 세 글자 이상이어야 한다
 * ("푸른"이 "푸른솔"에 들어 있다고 같은 곳으로 보면 안 된다).
 */
export function sameOrg(a: string, b: string): boolean {
  const x = placeKey(a);
  const y = placeKey(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.includes(short);
}

const inKorea = (lat: number, lng: number) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

/** 카카오가 어린이집(또는 유치원)으로 분류한 장소인가. 아파트·병원·학교·가게는 이름이 비슷해도 어린이집이 아니다 */
function isDaycare(doc: KakaoDocument): boolean {
  return doc.category_group_code === "PS3" || Boolean(doc.category_name?.includes("어린이집"));
}

/**
 * 검색 결과에서 org에 맞는 장소 하나를 고른다 (없으면 null).
 * 조건: 카카오가 어린이집으로 분류한 장소이고, 이름이 같은 어린이집으로 볼 수 있고, 주소가 서울이며(구를 알면 그 구),
 * 좌표가 한반도 안이어야 한다. 조건을 만족하는 결과가 여럿이면 카카오가 준 순서(정확도순)의 첫 번째를 쓴다.
 */
export function pickPlace(documents: readonly KakaoDocument[], org: string, region: string | null): PlaceMatch | null {
  const gu = districtOf(region);
  const best = documents.find((doc) => {
    if (!isDaycare(doc)) return false;
    const address = doc.road_address_name || doc.address_name || "";
    if (!address.startsWith("서울")) return false;
    if (gu && !address.includes(gu)) return false;
    return sameOrg(doc.place_name, org);
  });
  if (!best) return null;

  const lat = Number(best.y);
  const lng = Number(best.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) return null;
  return { lat, lng, label: `${best.place_name} · ${best.road_address_name || best.address_name || ""}`.trim() };
}

export function buildKeywordUrl(query: string): string {
  return `${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(query)}&size=15`;
}

/** 공고의 어린이집명은 "A, B"처럼 여럿이 이어질 수 있다. 첫 번째만 쓴다 */
function firstOrg(orgName: string): string {
  return orgName.split(",")[0].trim();
}

/**
 * 찾아볼 검색어를 가능성 높은 순서로 만든다 (중복은 뺀다). 한 어린이집에 호출은 많아야 세 번이다.
 *  1. "구 어린이집명"           — 이름 그대로
 *  2. "구 알맹이"               — 설립 형태·법인 표기·끝의 "어린이집"을 뗀 이름 ("마포구 가나다")
 *  3. "서울 알맹이 어린이집"    — 구를 빼고 서울 전체에서 ("서울 가나다 어린이집")
 * 알맹이가 두 글자 미만이면 2·3은 엉뚱한 결과만 부르므로 건너뛴다.
 */
export function searchQueries(org: string, gu: string | undefined): string[] {
  const area = gu ?? "서울";
  const core = placeKey(org);
  const queries = [`${area} ${org}`];
  if (core.length >= 2) queries.push(`${area} ${core}`, `서울 ${core} 어린이집`);
  return [...new Set(queries)];
}

function explain(status: number): string {
  if (status === 401) return "카카오 REST API 키가 올바르지 않아요. 앱의 REST API 키를 다시 확인해 주세요.";
  if (status === 403) return "카카오 로컬 API 사용이 막혀 있어요. 앱 설정에서 카카오맵(로컬) 사용 설정을 켰는지 확인해 주세요.";
  return "카카오 로컬 API의 호출 한도를 넘었어요. 잠시 뒤에 다시 시도해 주세요.";
}

/** 카카오 REST API 키로 어린이집 위치를 찾는 함수를 만든다. 한 어린이집에 호출은 많아야 세 번이다 */
export function createKakaoPlaceFinder(options: { http: HttpClient; restApiKey: string }): PlaceFinder {
  const { http, restApiKey } = options;

  async function search(query: string): Promise<KakaoDocument[]> {
    try {
      const response = await http.get(buildKeywordUrl(query), { headers: { Authorization: `KakaoAK ${restApiKey}` } });
      const parsed: unknown = JSON.parse(response.body);
      const documents = (parsed as { documents?: unknown } | null)?.documents;
      return Array.isArray(documents) ? (documents as KakaoDocument[]) : [];
    } catch (error) {
      if (error instanceof HttpError && error.status !== null && [401, 403, 429].includes(error.status)) {
        throw new KakaoApiError(explain(error.status), error.status);
      }
      throw error;
    }
  }

  return async (orgName, region) => {
    const org = firstOrg(orgName);
    if (org === "") return null;
    const gu = districtOf(region);

    // 이름 그대로 먼저 찾고, 못 찾으면 알맹이로 바꿔 찾는다. 어느 검색어든 결과는 pickPlace의 확인(이름·서울·구)을 통과해야 한다
    for (const query of searchQueries(org, gu)) {
      const place = pickPlace(await search(query), org, region);
      if (place) return place;
    }
    return null;
  };
}
