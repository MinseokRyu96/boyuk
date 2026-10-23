import { revalidateTag } from "next/cache";
import { findCollector } from "@/lib/collectors";
import { runCollector } from "@/lib/collectors/run";
import { isCronAuthorized } from "@/lib/cron-auth";
import { FEED_TAG } from "@/lib/feed-cache";

/** 소스 하나를 수집해 jobs에 저장하고 collector_runs에 결과를 남긴다 (부록 C) */
export async function GET(request: Request, ctx: RouteContext<"/api/cron/[source]">) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "인증에 실패했어요." }, { status: 401 });
  }

  const { source } = await ctx.params;
  const collector = findCollector(source);
  if (!collector) {
    return Response.json({ error: "알 수 없는 소스예요." }, { status: 404 });
  }
  if (collector.implemented === false) {
    return Response.json({ error: "아직 구현되지 않은 수집기예요.", source }, { status: 501 });
  }

  const result = await runCollector(collector);
  // 새 공고가 바로 보이도록 첫 화면 캐시를 즉시 무효화한다.
  // "max"는 갱신이 끝날 때까지 오래된 화면을 먼저 내줘서, 수집 직후 첫 방문자가 이전 데이터를 보게 된다(실제로 재현했다).
  // expire: 0이면 다음 요청이 새로 만든 화면을 받는다. 실패한 수집은 DB를 바꾸지 않았으므로 캐시를 건드리지 않는다.
  if (result.status === "success") revalidateTag(FEED_TAG, { expire: 0 });
  return Response.json(result, { status: result.status === "success" ? 200 : 502 });
}
