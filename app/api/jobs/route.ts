import type { NextRequest } from "next/server";
import { decodeCursor } from "@/lib/cursor";
import { parseDistricts } from "@/lib/districts";
import { fetchFeedPage } from "@/lib/jobs";

/**
 * 다음 20건. 마지막 응답이면 nextCursor가 null이다 (부록 C).
 * gu를 여러 번 쓰면(?gu=마포구&gu=서대문구) 그 구의 공고만 돌려준다. 서울의 구가 아닌 값은 400이다.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("cursor");
  const cursor = raw === null ? null : decodeCursor(raw);
  if (raw !== null && cursor === null) {
    return Response.json({ error: "cursor 형식이 올바르지 않아요." }, { status: 400 });
  }

  const districts = parseDistricts(request.nextUrl.searchParams.getAll("gu"));
  if (districts === null) {
    return Response.json({ error: "gu는 서울의 구 이름이어야 해요." }, { status: 400 });
  }

  try {
    const page = await fetchFeedPage(cursor, new Date(), districts);
    return Response.json(page, {
      // 수집은 하루 몇 번뿐이라 잠깐 캐시해도 화면이 달라지지 않는다. 응답 속도(500ms 이내)를 위해 CDN에 맡긴다.
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    console.error("[api/jobs]", e);
    return Response.json({ error: "공고를 불러오지 못했어요." }, { status: 500 });
  }
}
