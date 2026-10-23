import type { MapPoint } from "./types";

/** 지도의 핀 하나. 같은 자리(어린이집)의 공고를 모은다 */
export type MapPlace = {
  key: string;
  lat: number;
  lng: number;
  /** 핀을 눌렀을 때 지도 위에 띄우는 이름. 한 자리에 어린이집이 여럿이면 "가나다어린이집 외 1곳" */
  name: string;
  points: MapPoint[];
};

/** 좌표를 소수점 다섯째 자리(약 1m)까지 같으면 같은 자리로 본다. 같은 어린이집의 공고는 위치를 재사용해 좌표가 똑같다 */
const placeKeyOf = (point: MapPoint) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;

/**
 * 공고를 자리별로 묶는다. 한 어린이집이 공고를 여러 건 올리면 핀이 겹쳐서 하나만 눌리므로, 핀 하나에 공고를 모두 담는다.
 * 순서는 처음 나온 공고(최신순)를 따른다.
 */
export function groupPlaces(points: readonly MapPoint[]): MapPlace[] {
  const places = new Map<string, MapPlace>();
  for (const point of points) {
    const key = placeKeyOf(point);
    const place = places.get(key) ?? { key, lat: point.lat, lng: point.lng, name: "", points: [] };
    place.points.push(point);
    places.set(key, place);
  }
  for (const place of places.values()) {
    const names = [...new Set(place.points.map((point) => point.orgName))];
    place.name = names.length > 1 ? `${names[0]} 외 ${names.length - 1}곳` : names[0];
  }
  return [...places.values()];
}
