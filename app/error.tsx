"use client";

import { useEffect } from "react";
import { RetryNotice } from "@/components/RetryNotice";

/** 첫 화면을 서버에서 만들다 실패했을 때의 안내 (F10) */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center bg-surface">
      <RetryNotice title="공고를 불러오지 못했어요" description="잠시 후 다시 시도해 주세요." onRetry={retry} />
    </div>
  );
}
