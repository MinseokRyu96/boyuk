"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "seed-design/ui/action-button";
import type { SeoulGu } from "@/lib/districts";
import type { SourceCode } from "@/lib/sources";
import { loadKakaoMaps, type KakaoClusterer, type KakaoMapInstance, type KakaoMapsApi, type KakaoMarker } from "@/lib/kakao-sdk";
import type { MapData, MapPoint } from "@/lib/types";
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
 * 공고가 있는 어린이집을 카카오맵에 마커로 보여 준다. 가까운 마커는 숫자로 묶이고(클러스터), 마커를 누르면 그 공고 카드가 아래에 뜬다.
 * 위치를 찾지 못한 공고는 지도에 없어서 몇 건인지 알려 주고 목록으로 안내한다.
 */
export function MapView({ appKey, districts, sources, onShowList }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [maps, setMaps] = useState<KakaoMapsApi | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [dataFailed, setDataFailed] = useState(false);
  /** 시도 횟수. 올리면 SDK와 데이터를 다시 받는다 ("다시 시도") */
  const [attempt, setAttempt] = useState(0);
  const map = useRef<KakaoMapInstance | null>(null);
  const clusterer = useRef<KakaoClusterer | null>(null);

  // 지도(SDK)를 불러와 만든다
  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps(appKey)
      .then((api) => {
        if (cancelled || !container.current) return;
        map.current = new api.Map(container.current, { center: new api.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng), level: 8 });
        clusterer.current = new api.MarkerClusterer({ map: map.current, averageCenter: true, minLevel: 6 });
        api.event.addListener(map.current, "click", () => setSelected(null));
        setMaps(api);
      })
      .catch(() => {
        if (!cancelled) setSdkFailed(true);
      });
    return () => {
      cancelled = true;
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

  // 지도와 공고가 모두 준비되면 마커를 새로 찍고, 찍은 곳이 한눈에 보이도록 지도를 맞춘다
  useEffect(() => {
    if (!maps || !data || !map.current || !clusterer.current) return;
    const markers: KakaoMarker[] = data.points.map((point) => {
      const marker = new maps.Marker({ position: new maps.LatLng(point.lat, point.lng), title: point.orgName, clickable: true });
      maps.event.addListener(marker, "click", () => setSelected(point));
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
      <div
        ref={container}
        role="region"
        aria-label="공고가 있는 어린이집 위치 지도"
        className="h-[56dvh] min-h-[320px] w-full overflow-hidden rounded-r4 border border-stroke-neutral-muted bg-bg-neutral-weak"
      />

      <p className="sr-only" aria-live="polite">
        {data ? `지도에 공고 ${data.points.length}곳을 표시했어요` : "지도를 불러오는 중이에요"}
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

      {selected && (
        <div className="mt-x3">
          <JobCard card={selected} />
        </div>
      )}
    </div>
  );
}
