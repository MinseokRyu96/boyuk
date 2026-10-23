"use client";

import { ResultSection } from "seed-design/ui/result-section";

type Props = {
  title: string;
  description: string;
  onRetry: () => void;
  busy?: boolean;
  /** 버튼 글자. 기본은 "다시 불러오기" */
  actionLabel?: string;
};

/** 공고가 없거나 불러오기에 실패했을 때의 안내와 "다시 불러오기" 버튼 (F10) */
export function RetryNotice({ title, description, onRetry, busy = false, actionLabel = "다시 불러오기" }: Props) {
  return (
    <div role="alert" className="px-x4 py-x6">
      <ResultSection
        size="medium"
        title={title}
        description={description}
        primaryActionProps={{
          variant: "brandSolid",
          // 터치 영역 기준(44px)을 넘기려고 large(48px)를 쓴다. medium은 40px이다
          size: "large",
          children: busy ? "불러오는 중…" : actionLabel,
          onClick: onRetry,
          loading: busy,
          disabled: busy,
        }}
      />
    </div>
  );
}
