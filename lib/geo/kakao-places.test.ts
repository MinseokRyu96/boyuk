import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient, type HttpResponse } from "../collectors/http";
import {
  KAKAO_KEYWORD_URL,
  KakaoApiError,
  buildKeywordUrl,
  createKakaoPlaceFinder,
  pickPlace,
  placeKey,
  sameOrg,
  type KakaoDocument,
} from "./kakao-places";

/** 카카오가 문서에 밝힌 응답 모양을 본뜬 가짜 장소. 이름과 주소는 모두 지어낸 값이다 */
const doc = (placeName: string, address: string, extra: Partial<KakaoDocument> = {}): KakaoDocument => ({
  id: "1",
  place_name: placeName,
  category_name: "가정,생활 > 보육시설 > 어린이집",
  address_name: address,
  road_address_name: "",
  x: "126.9100",
  y: "37.5500",
  ...extra,
});

describe("placeKey / sameOrg", () => {
  it("설립 형태·법인 표기·공백·끝의 '어린이집'을 떼고 비교한다", () => {
    expect(placeKey("구립 가나다 어린이집")).toBe("가나다");
    expect(placeKey("가나다어린이집 서울형")).toBe("가나다");
    expect(placeKey("(재)라마바 직장어린이집")).toBe("라마바");
    expect(sameOrg("가나다어린이집 서울형", "구립가나다어린이집")).toBe(true);
  });

  it("한쪽이 다른 쪽을 포함해도 짧은 쪽이 두 글자 이하면 같은 곳으로 보지 않는다", () => {
    expect(sameOrg("푸른어린이집", "푸른솔어린이집")).toBe(false);
    expect(sameOrg("푸른솔어린이집", "푸른솔숲어린이집")).toBe(true);
    expect(sameOrg("푸른어린이집", "푸른어린이집")).toBe(true);
  });

  it("전혀 다른 이름과 빈 이름은 다르다", () => {
    expect(sameOrg("가나다어린이집", "라마바어린이집")).toBe(false);
    expect(sameOrg("", "가나다어린이집")).toBe(false);
    expect(sameOrg("어린이집", "가나다어린이집")).toBe(false);
  });
});

describe("pickPlace", () => {
  it("이름이 같고 주소가 해당 구이면 좌표(x=경도, y=위도)와 확인용 문구를 돌려준다", () => {
    const match = pickPlace([doc("가나다어린이집", "서울 마포구 상암동 1")], "가나다어린이집", "서울 마포구");
    expect(match).toEqual({ lat: 37.55, lng: 126.91, label: "가나다어린이집 · 서울 마포구 상암동 1" });
  });

  it("도로명 주소가 있으면 문구에는 도로명 주소를 쓴다", () => {
    const match = pickPlace([doc("가나다어린이집", "서울 마포구 상암동 1", { road_address_name: "서울 마포구 월드컵북로 1" })], "가나다어린이집", "서울 마포구");
    expect(match?.label).toBe("가나다어린이집 · 서울 마포구 월드컵북로 1");
  });

  it("다른 구에 있는 같은 이름의 어린이집은 거른다", () => {
    expect(pickPlace([doc("가나다어린이집", "서울 은평구 응암동 1")], "가나다어린이집", "서울 마포구")).toBeNull();
  });

  it("서울이 아닌 곳, 이름이 다른 곳은 거른다", () => {
    expect(pickPlace([doc("가나다어린이집", "경기 성남시 분당구 1")], "가나다어린이집", "서울 마포구")).toBeNull();
    expect(pickPlace([doc("라마바어린이집", "서울 마포구 1")], "가나다어린이집", "서울 마포구")).toBeNull();
  });

  it("구를 모르면(지역이 '서울'뿐) 서울 안이기만 하면 된다", () => {
    expect(pickPlace([doc("가나다어린이집", "서울 은평구 응암동 1")], "가나다어린이집", "서울")).not.toBeNull();
  });

  it("조건을 만족하는 결과가 여럿이면 어린이집 카테고리를, 그다음 먼저 온 것을 고른다", () => {
    const docs = [
      doc("가나다어린이집", "서울 마포구 1", { category_name: "교육,학문 > 학원", x: "126.1", y: "37.1" }),
      doc("가나다어린이집", "서울 마포구 2", { x: "126.92", y: "37.52" }),
      doc("가나다어린이집", "서울 마포구 3", { x: "126.93", y: "37.53" }),
    ];
    expect(pickPlace(docs, "가나다어린이집", "서울 마포구")).toMatchObject({ lat: 37.52, lng: 126.92 });
  });

  it("좌표가 숫자가 아니거나 한반도 밖이면 버린다", () => {
    expect(pickPlace([doc("가나다어린이집", "서울 마포구 1", { x: "abc", y: "37.5" })], "가나다어린이집", "서울 마포구")).toBeNull();
    expect(pickPlace([doc("가나다어린이집", "서울 마포구 1", { x: "126.9", y: "10.0" })], "가나다어린이집", "서울 마포구")).toBeNull();
  });

  it("결과가 없으면 null", () => {
    expect(pickPlace([], "가나다어린이집", "서울 마포구")).toBeNull();
  });
});

function ok(body: unknown): HttpResponse {
  return { status: 200, body: JSON.stringify(body), headers: new Headers(), attempts: 1 };
}

function fakeHttp(replies: (HttpResponse | Error)[]) {
  const queue = [...replies];
  const get = vi.fn(async (_url: string, _init?: { headers?: Record<string, string> }) => {
    const reply = queue.shift() ?? ok({ documents: [] });
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { http: { get } as HttpClient, get };
}

describe("buildKeywordUrl", () => {
  it("검색어를 인코딩하고 한 번에 15건을 받는다", () => {
    expect(buildKeywordUrl("마포구 가나다어린이집")).toBe(`${KAKAO_KEYWORD_URL}?query=${encodeURIComponent("마포구 가나다어린이집")}&size=15`);
  });
});

describe("createKakaoPlaceFinder", () => {
  it("구를 붙여 한 번 검색해 찾으면 거기서 끝내고, REST API 키를 Authorization 헤더로 보낸다", async () => {
    const { http, get } = fakeHttp([ok({ documents: [doc("가나다어린이집", "서울 마포구 상암동 1")] })]);
    const find = createKakaoPlaceFinder({ http, restApiKey: "TESTKEY" });

    expect(await find("가나다어린이집", "서울 마포구")).toMatchObject({ lat: 37.55, lng: 126.91 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(get.mock.calls[0][0])).toContain("query=마포구 가나다어린이집");
    expect(get.mock.calls[0][1]).toEqual({ headers: { Authorization: "KakaoAK TESTKEY" } });
  });

  it("첫 검색에서 못 찾으면 이름만으로 한 번 더 찾고, 그래도 없으면 null (호출은 최대 두 번)", async () => {
    const second = fakeHttp([ok({ documents: [] }), ok({ documents: [doc("가나다어린이집", "서울 마포구 1")] })]);
    expect(await createKakaoPlaceFinder({ http: second.http, restApiKey: "K" })("가나다어린이집", "서울 마포구")).not.toBeNull();
    expect(second.get).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(second.get.mock.calls[1][0])).toContain("query=가나다어린이집&");

    const none = fakeHttp([ok({ documents: [] }), ok({ documents: [] })]);
    expect(await createKakaoPlaceFinder({ http: none.http, restApiKey: "K" })("가나다어린이집", "서울 마포구")).toBeNull();
    expect(none.get).toHaveBeenCalledTimes(2);
  });

  it("'A, B'처럼 여럿이 이어진 이름은 첫 번째로 찾는다", async () => {
    const { http, get } = fakeHttp([ok({ documents: [doc("가나다어린이집", "서울 마포구 1")] })]);
    await createKakaoPlaceFinder({ http, restApiKey: "K" })("가나다어린이집, 라마바어린이집", "서울 마포구");
    expect(decodeURIComponent(get.mock.calls[0][0])).toContain("query=마포구 가나다어린이집&");
  });

  it("지역이 '서울'뿐이면 검색어에 서울을 붙인다", async () => {
    const { http, get } = fakeHttp([ok({ documents: [doc("가나다어린이집", "서울 마포구 1")] })]);
    await createKakaoPlaceFinder({ http, restApiKey: "K" })("가나다어린이집", "서울");
    expect(decodeURIComponent(get.mock.calls[0][0])).toContain("query=서울 가나다어린이집&");
  });

  it("키·권한·한도 오류(401·403·429)는 KakaoApiError로 바꿔 던진다", async () => {
    for (const status of [401, 403, 429]) {
      const { http } = fakeHttp([new HttpError(`HTTP ${status}`, status, "https://dapi.kakao.com", 1)]);
      await expect(createKakaoPlaceFinder({ http, restApiKey: "K" })("가나다어린이집", "서울 마포구")).rejects.toMatchObject({
        name: "KakaoApiError",
        status,
      });
    }
    const { http } = fakeHttp([new HttpError("HTTP 401", 401, "https://dapi.kakao.com", 1)]);
    await expect(createKakaoPlaceFinder({ http, restApiKey: "K" })("가나다어린이집", "서울 마포구")).rejects.toThrow(/REST API 키/);
  });

  it("그 밖의 오류(연결 실패 등)는 그대로 던지고, 응답 모양이 이상하면 결과 없음으로 본다", async () => {
    const down = fakeHttp([new HttpError("요청에 실패했어요", null, "https://dapi.kakao.com", 4)]);
    const error = await createKakaoPlaceFinder({ http: down.http, restApiKey: "K" })("가나다어린이집", "서울 마포구").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).not.toBeInstanceOf(KakaoApiError);

    const odd = fakeHttp([ok({ unexpected: true }), ok(null)]);
    expect(await createKakaoPlaceFinder({ http: odd.http, restApiKey: "K" })("가나다어린이집", "서울 마포구")).toBeNull();
  });

  it("이름이 비어 있으면 검색하지 않는다", async () => {
    const { http, get } = fakeHttp([]);
    expect(await createKakaoPlaceFinder({ http, restApiKey: "K" })("  ,", "서울 마포구")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
