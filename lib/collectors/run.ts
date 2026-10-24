import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeKey } from "../dedupe";
import { isChildcareContext, isTarget } from "../normalize";
import { geocodeFromEnv } from "../geo/geocode";
import { getAdminClient } from "../supabase";
import { TARGET_PROVINCES } from "./config";
import { isInTargetRegion } from "./region";
import type { Collector, RawJob } from "./types";

export type RunResult = {
  source: string;
  status: "success" | "failed";
  fetched: number;
  saved: number;
  /** 원문 목록을 일부만 가져와서 "사라진 공고" 처리를 건너뛰었으면 true */
  partial?: boolean;
  error?: string;
};

type JobRow = {
  source: string;
  source_id: string;
  title: string;
  org_name: string | null;
  region: string | null;
  deadline: string | null;
  url: string;
  is_workplace: boolean;
  dedupe_key: string | null;
  is_active: boolean;
  last_seen_at: string;
};

function toRow(collector: Collector, job: RawJob, seenAt: string): JobRow {
  return {
    source: collector.source,
    source_id: job.sourceId,
    title: job.title,
    org_name: job.orgName?.trim() || null,
    region: job.region ?? null,
    deadline: job.deadline ?? null,
    url: job.url,
    is_workplace: job.isWorkplace ?? collector.isWorkplace,
    dedupe_key: dedupeKey(job.orgName, job.deadline),
    // 사라졌다가 다시 올라온 공고는 되살린다. 만료된 공고는 마지막 단계에서 다시 숨긴다
    is_active: true,
    last_seen_at: seenAt,
  };
}

/**
 * 저장 대상인가: 신입·담임 판별을 통과하고, 범용 소스라면 어린이집 맥락도 있어야 하고,
 * 보여 줄 지역(config.ts의 TARGET_PROVINCES, 지금은 서울)의 공고여야 한다. 지역을 모르는 공고는 저장하지 않는다.
 * 단 수집기가 keepOutsideRegion으로 고른 공고는 지역과 상관없이 저장한다.
 */
function shouldSave(collector: Collector, job: RawJob): boolean {
  const inRegion = isInTargetRegion(job.region, TARGET_PROVINCES) || collector.keepOutsideRegion?.(job) === true;
  return isTarget(job) && (!collector.needsChildcareContext || isChildcareContext(job)) && inRegion;
}

async function record(db: SupabaseClient, startedAt: Date, result: RunResult): Promise<void> {
  const { error } = await db.from("collector_runs").insert({
    source: result.source,
    started_at: startedAt.toISOString(),
    status: result.status,
    fetched_count: result.fetched,
    saved_count: result.saved,
    // 실패 원인을 적는 칸이지만, 성공했어도 일부만 가져온 실행은 그 사실을 남겨 둔다
    error_message: result.error ?? (result.partial ? "일부만 수집해 사라진 공고 처리를 건너뜀" : null),
  });
  // 기록 실패가 수집 결과를 덮어쓰지 않도록 로그만 남긴다
  if (error) console.error(`[collector:${result.source}] collector_runs 기록 실패: ${error.message}`);
}

/** 수집 직후 새 공고의 위치를 채운다 (지도 보기용). 카카오 키가 없으면 아무것도 하지 않는다 */
async function geocodeNewJobs(db: SupabaseClient): Promise<unknown> {
  return geocodeFromEnv(db, { limit: 40 });
}

export type RunOptions = {
  /** 수집 직후 위치를 채우는 함수. 시험에서 바꿀 수 있고, 생략하면 카카오 키가 있을 때만 채운다 */
  geocode?: (db: SupabaseClient) => Promise<unknown>;
};

/**
 * 수집 → 판별 → 중복 키 → upsert → 위치 채우기 → 마감 처리 → 실행 기록 (PRD 6장, 부록 D).
 * 수집기 하나가 던진 오류는 이 함수 안에서 막아 다른 소스에 번지지 않게 한다.
 * db는 시험에서 가짜를 넣을 수 있도록 바꿀 수 있고, 생략하면 service role 클라이언트를 쓴다.
 */
export async function runCollector(collector: Collector, db: SupabaseClient = getAdminClient(), options: RunOptions = {}): Promise<RunResult> {
  const startedAt = new Date();
  const seenAt = startedAt.toISOString();
  const result: RunResult = { source: collector.source, status: "success", fetched: 0, saved: 0 };

  try {
    const { jobs: fetched, complete } = await collector.fetchJobs();
    result.fetched = fetched.length;

    // 0건은 사이트 개편으로 수집기가 깨졌다는 신호일 수 있다. 정상 처리하면 기존 공고를 모두 숨기게 되므로 실패로 본다.
    if (fetched.length === 0) throw new Error("수집된 공고가 0건이에요. 사이트 구조가 바뀌었는지 확인해 주세요.");

    // 같은 실행에서 같은 공고가 두 번 오면 upsert가 한 문장 안에서 충돌하므로 미리 하나로 합친다
    const rows = new Map<string, JobRow>();
    for (const job of fetched) {
      if (shouldSave(collector, job)) rows.set(job.sourceId, toRow(collector, job, seenAt));
    }
    result.saved = rows.size;

    if (rows.size > 0) {
      const { error } = await db.from("jobs").upsert([...rows.values()], { onConflict: "source,source_id" });
      if (error) throw new Error(`jobs 저장 실패: ${error.message}`);
    }

    // 위치를 못 채워도 수집은 성공이다. 지도에서만 빠지고 다음 수집에서 다시 시도한다
    try {
      await (options.geocode ?? geocodeNewJobs)(db);
    } catch (e) {
      console.error(`[collector:${collector.source}] 위치 채우기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (complete) {
      // 원문 목록에서 사라진 공고를 숨긴다. 이번 수집에서 확인되지 않은(last_seen_at이 오래된) 공고가 대상이다.
      const gone = await db
        .from("jobs")
        .update({ is_active: false })
        .eq("source", collector.source)
        .eq("is_active", true)
        .lt("last_seen_at", seenAt);
      if (gone.error) throw new Error(`사라진 공고 처리 실패: ${gone.error.message}`);
    } else {
      // 호출 한도나 쪽 상한 때문에 목록의 일부만 가져왔다. "이번 목록에 없다"가 "원문에서 사라졌다"를 뜻하지 않으므로
      // 숨기지 않는다. 이런 공고는 마감일 지남·30일 경과 처리가 정리한다.
      result.partial = true;
    }

    const expired = await db.rpc("deactivate_expired_jobs");
    if (expired.error) throw new Error(`마감 처리 실패: ${expired.error.message}`);
  } catch (e) {
    result.status = "failed";
    result.error = e instanceof Error ? e.message : String(e);
  }

  await record(db, startedAt, result);
  return result;
}
