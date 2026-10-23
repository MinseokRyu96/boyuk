import { describe, expect, it } from "vitest";
import { groupPlaces } from "./map-places";
import type { MapPoint } from "./types";

const point = (key: string, orgName: string, lat: number, lng: number): MapPoint => ({
  key,
  orgName,
  title: `${orgName} 담임교사`,
  region: "서울 마포구",
  dDay: { label: "D-5", level: "normal" },
  sources: [{ code: "seoul_center", label: "서울시센터" }],
  isNew: false,
  isWorkplace: false,
  url: `https://example.com/${key}`,
  lat,
  lng,
});

describe("groupPlaces", () => {
  it("같은 자리의 공고를 핀 하나로 묶고, 이름은 그 어린이집 이름이다", () => {
    const places = groupPlaces([point("a", "가나다어린이집", 37.55, 126.91), point("b", "라마바어린이집", 37.6, 126.92), point("c", "가나다어린이집", 37.55, 126.91)]);
    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({ name: "가나다어린이집", lat: 37.55, lng: 126.91 });
    expect(places[0].points.map((p) => p.key)).toEqual(["a", "c"]);
    expect(places[1].name).toBe("라마바어린이집");
  });

  it("한 자리에 어린이집이 여럿이면 '첫 이름 외 N곳'", () => {
    const places = groupPlaces([point("a", "가나다어린이집", 37.55, 126.91), point("b", "라마바어린이집", 37.55, 126.91), point("c", "사아자어린이집", 37.550001, 126.910001)]);
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("가나다어린이집 외 2곳");
  });

  it("약 1m보다 떨어진 곳은 다른 핀이다", () => {
    expect(groupPlaces([point("a", "가", 37.55, 126.91), point("b", "가", 37.5501, 126.91)])).toHaveLength(2);
  });

  it("공고가 없으면 핀도 없다", () => {
    expect(groupPlaces([])).toEqual([]);
  });
});
