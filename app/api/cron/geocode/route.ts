import { revalidateTag } from "next/cache";
import { isCronAuthorized } from "@/lib/cron-auth";
import { FEED_TAG } from "@/lib/feed-cache";
import { geocodeFromEnv } from "@/lib/geo/geocode";
import { getAdminClient } from "@/lib/supabase";

/**
 * 위치를 아직 찾지 않은 공고의 위치를 한꺼번에 채운다 (지도 보기용). 한 번에 어린이집 150곳까지 찾는다.
 * 수집 직후에도 40곳씩 자동으로 채우므로, 이 주소는 처음 켤 때 기존 공고를 한 번에 채우거나 수동으로 다시 돌릴 때 쓴다.
 * 스케줄에는 넣지 않았다. CRON_SECRET이 필요하다.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "인증에 실패했어요." }, { status: 401 });
  }

  try {
    const stats = await geocodeFromEnv(getAdminClient(), { limit: 150 });
    if (stats === null) {
      return Response.json({ error: "KAKAO_REST_API_KEY 환경변수가 없어요." }, { status: 503 });
    }
    // 새 위치가 생겼으면 지도·피드가 바로 보이도록 첫 화면 캐시를 비운다
    if (stats.found > 0 || stats.reused > 0) revalidateTag(FEED_TAG, { expire: 0 });
    return Response.json(stats);
  } catch (e) {
    console.error("[api/cron/geocode]", e);
    return Response.json({ error: e instanceof Error ? e.message : "위치를 채우지 못했어요." }, { status: 502 });
  }
}
