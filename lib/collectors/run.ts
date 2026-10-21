import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeKey } from "../dedupe";
import { isTarget } from "../normalize";
import { getAdminClient } from "../supabase";
import type { Collector, RawJob } from "./types";

export type RunResult = {
  source: string;
  status: "success" | "failed";
  fetched: number;
  saved: number;
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
    is_workplace: collector.isWorkplace,
    dedupe_key: dedupeKey(job.orgName, job.deadline),
    // 사라졌다가 다시 올라온 공고는 되살린다. 만료된 공고는 마지막 단계에서 다시 숨긴다
    is_active: true,
    last_seen_at: seenAt,
  };
}

async function record(db: SupabaseClient, startedAt: Date, result: RunResult): Promise<void> {
  const { error } = await db.from("collector_runs").insert({
    source: result.source,
    started_at: startedAt.toISOString(),
    status: result.status,
    fetched_count: result.fetched,
    saved_count: result.saved,
    error_message: result.error ?? null,
  });
  // 기록 실패가 수집 결과를 덮어쓰지 않도록 로그만 남긴다
  if (error) console.error(`[collector:${result.source}] collector_runs 기록 실패: ${error.message}`);
}

/**
 * 수집 → 판별 → 중복 키 → upsert → 마감 처리 → 실행 기록 (PRD 6장, 부록 D).
 * 수집기 하나가 던진 오류는 이 함수 안에서 막아 다른 소스에 번지지 않게 한다.
 */
export async function runCollector(collector: Collector): Promise<RunResult> {
  const db = getAdminClient();
  const startedAt = new Date();
  const seenAt = startedAt.toISOString();
  const result: RunResult = { source: collector.source, status: "success", fetched: 0, saved: 0 };

  try {
    const fetched = await collector.fetchJobs();
    result.fetched = fetched.length;

    // 0건은 사이트 개편으로 수집기가 깨졌다는 신호일 수 있다. 정상 처리하면 기존 공고를 모두 숨기게 되므로 실패로 본다.
    if (fetched.length === 0) throw new Error("수집된 공고가 0건이에요. 사이트 구조가 바뀌었는지 확인해 주세요.");

    // 같은 실행에서 같은 공고가 두 번 오면 upsert가 한 문장 안에서 충돌하므로 미리 하나로 합친다
    const rows = new Map<string, JobRow>();
    for (const job of fetched.filter(isTarget)) rows.set(job.sourceId, toRow(collector, job, seenAt));
    result.saved = rows.size;

    if (rows.size > 0) {
      const { error } = await db.from("jobs").upsert([...rows.values()], { onConflict: "source,source_id" });
      if (error) throw new Error(`jobs 저장 실패: ${error.message}`);
    }

    // 원문 목록에서 사라진 공고를 숨긴다. 이번 수집에서 확인되지 않은(last_seen_at이 오래된) 공고가 대상이다.
    const gone = await db
      .from("jobs")
      .update({ is_active: false })
      .eq("source", collector.source)
      .eq("is_active", true)
      .lt("last_seen_at", seenAt);
    if (gone.error) throw new Error(`사라진 공고 처리 실패: ${gone.error.message}`);

    const expired = await db.rpc("deactivate_expired_jobs");
    if (expired.error) throw new Error(`마감 처리 실패: ${expired.error.message}`);
  } catch (e) {
    result.status = "failed";
    result.error = e instanceof Error ? e.message : String(e);
  }

  await record(db, startedAt, result);
  return result;
}
