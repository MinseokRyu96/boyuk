import { cacheLife, cacheTag } from "next/cache";
import { FEED_TAG } from "./feed-cache";
import { fetchDistrictCounts, fetchFeedPage, fetchLastCollectedAt, isSampleMode } from "./jobs";

/**
 * 피드 첫 화면 데이터. 수집은 하루 몇 번뿐이라 몇 분 캐시해도 화면이 달라지지 않고,
 * 수집이 끝나면 FEED_TAG로 바로 갱신한다.
 */
export async function getFirstPage() {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  cacheTag(FEED_TAG);

  const now = new Date();
  const [page, updatedAt, districtCounts] = await Promise.all([
    fetchFeedPage(null, now),
    fetchLastCollectedAt(now),
    fetchDistrictCounts(now),
  ]);
  return { page, updatedAt, districtCounts, serverNow: now.toISOString(), isSample: isSampleMode() };
}
