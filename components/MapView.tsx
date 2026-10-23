"use client";

import { IconCrosshairLine } from "@karrotmarket/react-monochrome-icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "seed-design/ui/action-button";
import type { SeoulGu } from "@/lib/districts";
import type { SourceCode } from "@/lib/sources";
import { loadKakaoMaps, type KakaoClusterer, type KakaoCustomOverlay, type KakaoMapInstance, type KakaoMapsApi, type KakaoMarker } from "@/lib/kakao-sdk";
import { groupPlaces, type MapPlace } from "@/lib/map-places";
import type { MapData } from "@/lib/types";
import { JobCard } from "./JobCard";
import { RetryNotice } from "./RetryNotice";

type Props = {
  /** 카카오맵 JavaScript 키 */
  appKey: string;
  /** 고른 구. 비어 있으면 서울 전체 */
  districts: readonly SeoulGu[];
  /** 고른 플랫폼(수집 출처). 비어 있으면 모든 플랫폼 */
  sources: readonly SourceCode[];
  /** "목록으로 보기" 누를 때 */
  onShowList: () => void;
};

/** 핀 위에 띄우는 이름표의 모양. 핀(약 40px) 위로 띄우려고 아래에 여백을 두고, 지도 조작을 막지 않게 누를 수 없게 한다 */
const LABEL_WRAPPER_CLASS = "pointer-events-none pb-[44px]";
const LABEL_CLASS = "t4-bold max-w-[220px] truncate rounded-full border border-stroke-neutral-muted bg-bg-layer-default px-x3 py-x1 text-fg-neutral shadow-[0_2px_6px_rgba(0,0,0,0.18)]";

function labelElement(text: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = LABEL_WRAPPER_CLASS;
  const label = document.createElement("div");
  label.className = LABEL_CLASS;
  // 어린이집 이름은 출처 사이트에서 온 글자라 HTML로 넣지 않는다
  label.textContent = text;
  wrapper.append(label);
  return wrapper;
}

/** 현재 위치 표시(파란 점). 지도 조작을 막지 않게 누를 수 없게 한다 */
const MY_LOCATION_CLASS = "pointer-events-none h-4 w-4 rounded-full border-2 border-white bg-palette-blue-600 shadow-[0_0_0_6px_rgba(37,99,235,0.2)]";

function myLocationElement(): HTMLElement {
  const dot = document.createElement("div");
  dot.className = MY_LOCATION_CLASS;
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/** 현재 위치로 옮길 때의 확대 단계 (축척 약 250m, 동네 어린이집이 보이는 정도) */
const MY_LOCATION_LEVEL = 5;

function locationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.";
  return "현재 위치를 찾지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/** 서울시청 근처. 찍을 공고가 없을 때의 지도 중심 */
const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };

async function requestMapData(districts: readonly SeoulGu[], sources: readonly SourceCode[]): Promise<MapData> {
  const params = new URLSearchParams();
  for (const gu of districts) params.append("gu", gu);
  for (const code of sources) params.append("src", code);
  const query = params.size > 0 ? `?${params}` : "";
  const res = await fetch(`/api/jobs/map${query}`);
  if (!res.ok) throw new Error(`지도 데이터 요청 실패 (${res.status})`);
  return res.json();
}

/**
 * 공고가 있는 어린이집을 카카오맵에 핀으로 보여 준다. 같은 어린이집의 공고는 핀 하나로 묶고, 가까운 핀은 숫자로 묶인다(클러스터).
 * 핀을 누르면 핀 위에 어린이집 이름이 뜨고, 지도 아래쪽에 그 어린이집의 공고 카드가 지도 안에 겹쳐 뜬다(스크롤하지 않아도 보인다).
 * 지도를 누르거나 닫기를 누르면 닫힌다. 위치를 찾지 못한 공고는 지도에 없어서 몇 건인지 알려 주고 목록으로 안내한다.
 */
export function MapView({ appKey, districts, sources, onShowList }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [maps, setMaps] = useState<KakaoMapsApi | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [selected, setSelected] = useState<MapPlace | null>(null);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [dataFailed, setDataFailed] = useState(false);
  /** 시도 횟수. 올리면 SDK와 데이터를 다시 받는다 ("다시 시도") */
  const [attempt, setAttempt] = useState(0);
  const map = useRef<KakaoMapInstance | null>(null);
  const clusterer = useRef<KakaoClusterer | null>(null);
  const label = useRef<KakaoCustomOverlay | null>(null);
  const myLocation = useRef<KakaoCustomOverlay | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // 지도(SDK)를 불러와 만든다
  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps(appKey)
      .then((api) => {
        if (cancelled || !container.current) return;
        map.current = new api.Map(container.current, { center: new api.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng), level: 8 });
        // 서울 전체를 볼 때(레벨 9, 축척 4km 이상)만 숫자로 묶고, 구 하나를 볼 만큼(축척 2km 이하) 확대하면 핀을 하나씩 보여 준다
        clusterer.current = new api.MarkerClusterer({ map: map.current, averageCenter: true, minLevel: 9 });
        api.event.addListener(map.current, "click", () => setSelected(null));
        setMaps(api);
      })
      .catch(() => {
        if (!cancelled) setSdkFailed(true);
      });
    return () => {
      cancelled = true;
      label.current?.setMap(null);
      label.current = null;
      myLocation.current?.setMap(null);
      myLocation.current = null;
      clusterer.current?.clear();
      clusterer.current = null;
      map.current = null;
      setMaps(null);
    };
  }, [appKey, attempt]);

  // 고른 구나 플랫폼이 바뀔 때마다 공고를 새로 받는다. 이전 선택의 늦은 응답은 버린다
  useEffect(() => {
    let cancelled = false;
    requestMapData(districts, sources)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setDataFailed(false);
        setSelected(null);
      })
      .catch(() => {
        if (!cancelled) setDataFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [districts, sources, attempt]);

  // 지도와 공고가 모두 준비되면 어린이집마다 핀을 새로 찍고, 찍은 곳이 한눈에 보이도록 지도를 맞춘다
  useEffect(() => {
    if (!maps || !data || !map.current || !clusterer.current) return;
    const markers: KakaoMarker[] = groupPlaces(data.points).map((place) => {
      const marker = new maps.Marker({ position: new maps.LatLng(place.lat, place.lng), title: place.name, clickable: true });
      maps.event.addListener(marker, "click", () => setSelected(place));
      return marker;
    });
    clusterer.current.clear();
    clusterer.current.addMarkers(markers);

    if (data.points.length > 0) {
      const bounds = new maps.LatLngBounds();
      for (const point of data.points) bounds.extend(new maps.LatLng(point.lat, point.lng));
      map.current.setBounds(bounds, 48, 48, 48, 48);
    } else {
      map.current.setCenter(new maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng));
      map.current.setLevel(8);
    }
  }, [maps, data]);

  // 고른 핀 위에 어린이집 이름을 띄우고, 그 자리로 지도를 옮긴다
  useEffect(() => {
    label.current?.setMap(null);
    label.current = null;
    if (!maps || !map.current || !selected) return;
    const position = new maps.LatLng(selected.lat, selected.lng);
    label.current = new maps.CustomOverlay({ position, content: labelElement(selected.name), yAnchor: 1, zIndex: 3 });
    label.current.setMap(map.current);
    // 아래쪽 공고 패널에 가리지 않도록, 고른 핀을 지도 위쪽(위에서 약 30%)에 둔다
    map.current.setCenter(position);
    const height = container.current?.clientHeight ?? 0;
    if (height > 0) map.current.panBy(0, Math.round(height * 0.2));
  }, [maps, selected]);

  // 위치 안내 문구는 잠시 보여 주고 지운다
  useEffect(() => {
    if (!locationError) return;
    const timer = setTimeout(() => setLocationError(null), 5000);
    return () => clearTimeout(timer);
  }, [locationError]);

  /** 브라우저에 현재 위치를 물어 그곳으로 지도를 옮기고 파란 점을 찍는다. 위치는 이 화면에서만 쓰고 어디에도 보내거나 저장하지 않는다 */
  const goToMyLocation = useCallback(() => {
    if (!maps || !map.current) return;
    if (!("geolocation" in navigator)) {
      setLocationError("이 브라우저에서는 현재 위치를 쓸 수 없어요.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        if (!map.current) return;
        const position = new maps.LatLng(coords.latitude, coords.longitude);
        myLocation.current?.setMap(null);
        myLocation.current = new maps.CustomOverlay({ position, content: myLocationElement(), yAnchor: 0.5, zIndex: 2 });
        myLocation.current.setMap(map.current);
        map.current.setLevel(MY_LOCATION_LEVEL);
        map.current.setCenter(position);
      },
      (error) => {
        setLocating(false);
        setLocationError(locationErrorMessage(error));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [maps]);

  const retry = useCallback(() => {
    setSdkFailed(false);
    setDataFailed(false);
    setData(null);
    setAttempt((n) => n + 1);
  }, []);

  if (sdkFailed) {
    return (
      <RetryNotice
        title="지도를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요. 계속 안 되면 카카오 개발자 사이트에 이 사이트 주소가 웹 도메인으로 등록되어 있는지 확인해야 해요."
        onRetry={retry}
        actionLabel="다시 시도"
      />
    );
  }
  if (dataFailed) {
    return <RetryNotice title="공고 위치를 불러오지 못했어요" description="네트워크를 확인하고 다시 시도해 주세요." onRetry={retry} actionLabel="다시 시도" />;
  }

  const unlocated = data ? data.total - data.points.length : 0;

  return (
    <div className="px-x4 pb-x6 pt-x3">
      <div className="relative">
        <div
          ref={container}
          role="region"
          aria-label="공고가 있는 어린이집 위치 지도"
          className="h-[56dvh] min-h-[320px] w-full overflow-hidden rounded-r4 border border-stroke-neutral-muted bg-bg-neutral-weak"
        />

        {maps && (
          <button
            type="button"
            onClick={goToMyLocation}
            disabled={locating}
            aria-label={locating ? "현재 위치를 찾는 중" : "현재 위치로 이동"}
            className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-stroke-neutral-muted bg-bg-layer-default text-fg-neutral shadow-[0_2px_6px_rgba(0,0,0,0.18)] active:bg-bg-layer-default-pressed disabled:text-fg-neutral-muted"
          >
            <IconCrosshairLine size={22} className={locating ? "animate-pulse" : undefined} />
          </button>
        )}

        {locationError && (
          <p role="status" className="t4-regular absolute left-2 right-16 top-2 z-10 rounded-r3 bg-bg-layer-default px-x3 py-x2 text-fg-neutral shadow-[0_2px_6px_rgba(0,0,0,0.18)]">
            {locationError}
          </p>
        )}

        {selected && (
          <section
            aria-label={`${selected.name} 공고`}
            className="absolute inset-x-2 bottom-2 z-10 flex max-h-[48%] flex-col rounded-r4 border border-stroke-neutral-muted bg-bg-layer-default shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
          >
            <div className="flex items-center justify-between gap-x2 border-b border-stroke-neutral-muted py-x1 pl-x4 pr-x1">
              <h3 className="t5-bold min-w-0 truncate text-fg-neutral">
                {selected.name}
                <span className="t4-regular ml-x2 text-fg-neutral-muted">공고 {selected.points.length}건</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="닫기"
                className="t4-medium flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-fg-neutral-muted active:bg-bg-layer-default-pressed"
              >
                닫기
              </button>
            </div>
            <ul className="flex flex-col gap-x2 overflow-y-auto p-x2">
              {selected.points.map((point) => (
                <li key={point.key}>
                  <JobCard card={point} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {selected ? `${selected.name}, 공고 ${selected.points.length}건` : data ? `지도에 공고 ${data.points.length}건을 표시했어요` : "지도를 불러오는 중이에요"}
      </p>

      {data && data.total > 0 && data.points.length === 0 && (
        <p className="t4-regular mt-x3 text-fg-neutral-muted">아직 위치를 찾은 공고가 없어요. 위치는 새 공고를 수집할 때마다 조금씩 채워져요.</p>
      )}

      {unlocated > 0 && data && data.points.length > 0 && (
        <div className="mt-x3 flex items-center justify-between gap-x3 rounded-r4 bg-bg-neutral-weak p-x3">
          <p className="t4-regular text-fg-neutral-muted">위치를 찾지 못한 공고 {unlocated}건은 지도에 없어요.</p>
          <ActionButton variant="neutralWeak" size="large" onClick={onShowList} className="shrink-0">
            목록 보기
          </ActionButton>
        </div>
      )}

    </div>
  );
}
