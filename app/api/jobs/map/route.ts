import type { NextRequest } from "next/server";
import { parseDistricts } from "@/lib/districts";
import { fetchMapData } from "@/lib/jobs";

/**
 * 지도에 찍을 공고(위치를 찾은 것)와 전체 건수. gu를 여러 번 쓰면(?gu=마포구&gu=서대문구) 그 구의 공고만 돌려준다.
 * 서울의 구가 아닌 값은 400이다.
 */
export async function GET(request: NextRequest) {
  const districts = parseDistricts(request.nextUrl.searchParams.getAll("gu"));
  if (districts === null) {
    return Response.json({ error: "gu는 서울의 구 이름이어야 해요." }, { status: 400 });
  }

  try {
    const data = await fetchMapData(new Date(), districts);
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    console.error("[api/jobs/map]", e);
    return Response.json({ error: "지도에 찍을 공고를 불러오지 못했어요." }, { status: 500 });
  }
}
