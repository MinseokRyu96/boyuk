import type { NextRequest } from "next/server";
import { decodeCursor } from "@/lib/cursor";
import { parseDistricts } from "@/lib/districts";
import { parseSort } from "@/lib/sort";
import { parseSources } from "@/lib/sources";
import { fetchFeedPage } from "@/lib/jobs";

/**
 * 다음 20건. 마지막 응답이면 nextCursor가 null이다 (부록 C).
 * gu를 여러 번 쓰면(?gu=마포구&gu=서대문구) 그 구의 공고만 돌려준다. 서울의 구가 아닌 값은 400이다.
 * src를 여러 번 쓰면(?src=samsung&src=hansol) 그 수집 출처(플랫폼)의 공고만 돌려준다. 알 수 없는 출처는 400이다.
 * 구와 출처를 함께 걸면 둘 다 만족하는 공고다. 필터가 걸린 응답에는 조건에 맞는 전체 건수(total)가 들어 있다.
 * sort는 new(기본, 등록 최신순)·soon(마감 임박순)·late(마감 늦은순)이다. 그 밖의 값은 400이다.
 * 마감일 정렬의 커서는 마감일을 담은 세 값이라, 정렬과 맞지 않는 커서는 400이다.
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

  const sources = parseSources(request.nextUrl.searchParams.getAll("src"));
  if (sources === null) {
    return Response.json({ error: "src는 알려진 수집 출처 코드여야 해요." }, { status: 400 });
  }

  const sort = parseSort(request.nextUrl.searchParams.get("sort"));
  if (sort === null) {
    return Response.json({ error: "sort는 new, soon, late 중 하나여야 해요." }, { status: 400 });
  }
  // 최신순 커서는 두 값, 마감일 정렬 커서는 마감일을 더한 세 값이다. 정렬을 바꿀 때는 커서 없이 처음부터 요청해야 한다
  if (cursor && (cursor.deadline === undefined) !== (sort === "new")) {
    return Response.json({ error: "cursor가 이 정렬과 맞지 않아요." }, { status: 400 });
  }

  try {
    const page = await fetchFeedPage(cursor, new Date(), { districts, sources }, sort);
    return Response.json(page, {
      // 수집은 하루 몇 번뿐이라 잠깐 캐시해도 화면이 달라지지 않는다. 응답 속도(500ms 이내)를 위해 CDN에 맡긴다.
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    console.error("[api/jobs]", e);
    return Response.json({ error: "공고를 불러오지 못했어요." }, { status: 500 });
  }
}
