import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { findCollector } from "@/lib/collectors";
import { runCollector } from "@/lib/collectors/run";
import { FEED_TAG } from "@/lib/feed-cache";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** 소스 하나를 수집해 jobs에 저장하고 collector_runs에 결과를 남긴다 (부록 C) */
export async function GET(request: Request, ctx: RouteContext<"/api/cron/[source]">) {
  if (!isAuthorized(request)) {
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
  // 새 공고가 바로 보이도록 첫 페이지 캐시를 오래된 것으로 표시한다
  revalidateTag(FEED_TAG, "max");
  return Response.json(result, { status: result.status === "success" ? 200 : 502 });
}
