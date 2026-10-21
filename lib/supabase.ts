import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** 읽기 전용(anon) 클라이언트. 환경변수가 없으면 null이고, 이때 피드는 샘플 데이터로 동작한다 */
export function getPublicClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, options);
}

/** 수집기의 쓰기 권한(service role). 서버 전용이며 없으면 오류를 던진다 */
export function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요.");
  }
  return createClient(url, key, options);
}
