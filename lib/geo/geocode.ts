import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHttpClient } from "../collectors/http";
import { KakaoApiError, createKakaoPlaceFinder, type PlaceFinder } from "./kakao-places";

/*
 * 위치를 아직 찾지 않은 공고의 어린이집 위치를 채운다 (지도 보기용).
 * 같은 어린이집(이름 + 구)은 한 번만 찾고 공고 전체에 같은 위치를 쓴다. 이미 찾아 둔 어린이집은 DB에서 재사용하므로
 * 카카오 호출은 "새로 나타난 어린이집" 수만큼만 생긴다.
 * 서울 공고만 대상이다 (지도는 서울만 다룬다). 못 찾은 공고는 'not_found'로 표시해 두고 일정 기간 뒤에 다시 찾아본다.
 */

export type GeocodeStats = {
  /** 위치를 채울 대상이었던 공고 수 */
  candidates: number;
  /** 어린이집(이름 + 구) 수 */
  places: number;
  /** DB에 이미 있는 위치를 재사용한 어린이집 수 */
  reused: number;
  /** 카카오에 검색한 어린이집 수 */
  searched: number;
  found: number;
  notFound: number;
  /** 연결 오류 등으로 이번에는 결과를 못 받은 어린이집 수 (다음에 다시 시도한다) */
  errors: number;
  /** 이번 호출 한도(limit)에 걸려 다음으로 미룬 어린이집 수 */
  deferred: number;
};

export type GeocodeOptions = {
  /** 한 번에 카카오에 검색할 어린이집 수 상한. 기본 40 */
  limit?: number;
  /** 못 찾은 공고를 다시 찾아보기까지의 일수. 기본 7 */
  retryAfterDays?: number;
  now?: Date;
};

type PendingRow = { id: string; org_name: string; region: string | null };
type KnownRow = { org_name: string; region: string | null; lat: number; lng: number; geo_place: string | null };

/** 같은 어린이집인지 가르는 키 (이름과 구) */
const placeId = (orgName: string, region: string | null) => `${orgName}\n${region ?? ""}`;

/** 한 번에 읽는 행 수. 서울센터가 400건 읽는 규모라 수백~천 건이면 충분하다 */
const ROW_LIMIT = 2000;

/** 연속으로 이만큼 오류가 나면 카카오나 네트워크에 문제가 있다고 보고 멈춘다 */
const MAX_CONSECUTIVE_ERRORS = 3;

async function fetchPending(db: SupabaseClient, retryBeforeIso: string): Promise<PendingRow[]> {
  const base = () =>
    db.from("jobs").select("id, org_name, region").eq("is_active", true).not("org_name", "is", null).like("region", "서울%").order("first_seen_at", { ascending: false }).limit(ROW_LIMIT);
  // 한 번에 or 조건으로 묻는 대신 두 번 물어 합친다: 아직 안 찾은 공고, 못 찾은 지 오래된 공고
  const [fresh, stale] = await Promise.all([base().is("geo_status", null), base().eq("geo_status", "not_found").lt("geocoded_at", retryBeforeIso)]);
  if (fresh.error) throw new Error(`위치를 채울 공고를 읽지 못했어요: ${fresh.error.message}`);
  if (stale.error) throw new Error(`위치를 채울 공고를 읽지 못했어요: ${stale.error.message}`);
  const seen = new Set<string>();
  return [...(fresh.data as PendingRow[]), ...(stale.data as PendingRow[])].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}

async function fetchKnown(db: SupabaseClient): Promise<Map<string, KnownRow>> {
  const { data, error } = await db.from("jobs").select("org_name, region, lat, lng, geo_place").eq("geo_status", "ok").not("org_name", "is", null).limit(ROW_LIMIT * 2);
  if (error) throw new Error(`찾아 둔 위치를 읽지 못했어요: ${error.message}`);
  const known = new Map<string, KnownRow>();
  for (const row of data as KnownRow[]) known.set(placeId(row.org_name, row.region), row);
  return known;
}

/** 위치를 아직 모르는 공고의 위치를 채운다. 키·권한·한도 오류(KakaoApiError)는 그대로 던져 나머지를 멈춘다 */
export async function geocodePending(db: SupabaseClient, find: PlaceFinder, options: GeocodeOptions = {}): Promise<GeocodeStats> {
  const { limit = 40, retryAfterDays = 7, now = new Date() } = options;
  const nowIso = now.toISOString();
  const retryBefore = new Date(now.getTime() - retryAfterDays * 24 * 60 * 60 * 1000).toISOString();

  const pending = await fetchPending(db, retryBefore);
  const stats: GeocodeStats = { candidates: pending.length, places: 0, reused: 0, searched: 0, found: 0, notFound: 0, errors: 0, deferred: 0 };
  if (pending.length === 0) return stats;

  // 어린이집(이름 + 구)별로 묶는다. 최근 공고가 먼저 나오도록 읽었으므로 그 순서를 유지한다
  const groups = new Map<string, { orgName: string; region: string | null; ids: string[] }>();
  for (const row of pending) {
    const key = placeId(row.org_name, row.region);
    const group = groups.get(key) ?? { orgName: row.org_name, region: row.region, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }
  stats.places = groups.size;

  const known = await fetchKnown(db);
  let consecutiveErrors = 0;
  let stopped = false;

  for (const [key, group] of groups) {
    const reuse = known.get(key);
    if (reuse) {
      const { error } = await db.from("jobs").update({ lat: reuse.lat, lng: reuse.lng, geo_status: "ok", geo_place: reuse.geo_place, geocoded_at: nowIso }).in("id", group.ids);
      if (error) throw new Error(`위치를 저장하지 못했어요: ${error.message}`);
      stats.reused++;
      continue;
    }
    if (stopped || stats.searched >= limit) {
      stats.deferred++;
      continue;
    }

    stats.searched++;
    let match;
    try {
      match = await find(group.orgName, group.region);
      consecutiveErrors = 0;
    } catch (error) {
      if (error instanceof KakaoApiError) throw error;
      stats.errors++;
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) stopped = true;
      continue;
    }

    const values = match
      ? { lat: match.lat, lng: match.lng, geo_status: "ok", geo_place: match.label, geocoded_at: nowIso }
      : { lat: null, lng: null, geo_status: "not_found", geo_place: null, geocoded_at: nowIso };
    const { error } = await db.from("jobs").update(values).in("id", group.ids);
    if (error) throw new Error(`위치를 저장하지 못했어요: ${error.message}`);
    if (match) {
      stats.found++;
      known.set(key, { org_name: group.orgName, region: group.region, lat: match.lat, lng: match.lng, geo_place: match.label });
    } else {
      stats.notFound++;
    }
  }
  return stats;
}

/**
 * 환경변수의 카카오 REST API 키로 위치를 채운다. 키가 없으면 아무것도 하지 않고 null이다.
 * 수집기(수집 직후)와 /api/cron/geocode(한꺼번에 채우기)가 함께 쓴다.
 */
export async function geocodeFromEnv(db: SupabaseClient, options: GeocodeOptions = {}): Promise<GeocodeStats | null> {
  const restApiKey = process.env.KAKAO_REST_API_KEY;
  if (!restApiKey) return null;
  // 카카오 API는 호출 간격 제한이 느슨해서 수집기(2초)보다 촘촘하게 부른다
  const http = createHttpClient({ minIntervalMs: 150 });
  return geocodePending(db, createKakaoPlaceFinder({ http, restApiKey }), options);
}
