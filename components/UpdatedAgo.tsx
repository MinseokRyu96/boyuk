"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/time";

/**
 * "N분 전 업데이트". 첫 렌더는 서버가 정한 시각으로 그려 서버·클라이언트 출력이 같게 하고,
 * 마운트한 뒤부터 실제 시계로 갱신한다.
 */
export function UpdatedAgo({ updatedAt, serverNow }: { updatedAt: string | null; serverNow: string }) {
  const [now, setNow] = useState(() => new Date(serverNow));

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (!updatedAt) return <span>아직 수집 전이에요</span>;
  return <span>{relativeTime(updatedAt, now)} 업데이트</span>;
}
