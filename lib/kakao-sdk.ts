/*
 * 카카오맵 JavaScript SDK를 브라우저에서 불러온다 (지도 보기용).
 *   <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey={JavaScript 키}&autoload=false&libraries=clusterer">
 * JavaScript 키는 화면에 그대로 노출되는 값이라(NEXT_PUBLIC_KAKAO_MAP_KEY) 도메인 등록으로 보호한다. 카카오 개발자 사이트의
 * 앱 > 플랫폼 > Web에 이 사이트 주소(https://boyuk.vercel.app, 개발 중에는 http://localhost:3000)를 등록해야 지도가 뜬다.
 * 이 프로젝트가 쓰는 부분만 타입으로 적었다 (공식 문서: https://apis.map.kakao.com/web/documentation/).
 */

export type KakaoLatLng = object;

export interface KakaoBounds {
  extend(position: KakaoLatLng): void;
}

export interface KakaoMapInstance {
  setBounds(bounds: KakaoBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
  setCenter(position: KakaoLatLng): void;
  setLevel(level: number): void;
  panTo(position: KakaoLatLng): void;
  relayout(): void;
}

export interface KakaoMarker {
  setMap(map: KakaoMapInstance | null): void;
}

export interface KakaoClusterer {
  addMarkers(markers: KakaoMarker[]): void;
  clear(): void;
}

export interface KakaoMapsApi {
  /** autoload=false로 불러온 SDK는 이 함수 안에서 쓸 수 있게 된다 */
  load(callback: () => void): void;
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMapInstance;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoBounds;
  Marker: new (options: { position: KakaoLatLng; title?: string; clickable?: boolean }) => KakaoMarker;
  MarkerClusterer: new (options: { map: KakaoMapInstance; averageCenter?: boolean; minLevel?: number }) => KakaoClusterer;
  event: { addListener(target: object, type: string, handler: () => void): void };
}

declare global {
  interface Window {
    kakao?: { maps?: KakaoMapsApi };
  }
}

let loading: Promise<KakaoMapsApi> | null = null;

/** SDK를 한 번만 불러와 쓸 수 있는 상태의 kakao.maps를 돌려준다. 실패하면 다음에 다시 시도할 수 있다 */
export function loadKakaoMaps(appKey: string): Promise<KakaoMapsApi> {
  if (loading) return loading;

  const attempt = new Promise<KakaoMapsApi>((resolve, reject) => {
    const ready = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        reject(new Error("카카오 지도 SDK를 읽지 못했어요."));
        return;
      }
      maps.load(() => resolve(maps));
    };

    if (window.kakao?.maps) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=clusterer`;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("카카오 지도 SDK를 불러오지 못했어요."));
    document.head.append(script);
  });

  loading = attempt;
  attempt.catch(() => {
    loading = null;
  });
  return attempt;
}
