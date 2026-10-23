"use client";

import { Chip } from "seed-design/ui/chip";
import { SEOUL_GU, type DistrictCounts, type SeoulGu } from "@/lib/districts";

/** SEED 칩의 가장 큰 크기(large)가 40px이라, 터치 영역 기준(44px)에 맞추려고 높이를 키운다 */
const CHIP_CLASS = "min-h-11";

type Props = {
  counts: DistrictCounts;
  selected: readonly SeoulGu[];
  onChange: (next: SeoulGu[]) => void;
};

/**
 * 서울 구별 필터. 맨 앞 "전체"와 공고가 있는 구를 가로로 늘어놓고, 구는 여러 개를 함께 고를 수 있다.
 * 헤더 바로 아래에 붙어서 목록을 내려도 계속 보인다 (헤더 높이 57px = min-h-14 + 테두리 1px).
 */
export function DistrictFilter({ counts, selected, onChange }: Props) {
  // 공고가 없는 구는 숨기되, 이미 골라 둔 구는 풀 수 있도록 남긴다
  const visible = SEOUL_GU.filter((gu) => (counts.byDistrict[gu] ?? 0) > 0 || selected.includes(gu));

  const toggle = (gu: SeoulGu, on: boolean) => onChange(SEOUL_GU.filter((name) => (name === gu ? on : selected.includes(name))));

  return (
    <div className="sticky top-[57px] z-[5] border-b border-stroke-neutral-muted bg-bg-layer-default">
      <ul role="group" aria-label="서울 지역 선택" className="flex gap-x2 overflow-x-auto px-x4 py-x3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <li className="shrink-0">
          <Chip.Toggle size="large" variant="outlineWeak" className={CHIP_CLASS} checked={selected.length === 0} onCheckedChange={() => onChange([])}>
            <Chip.Label>전체 {counts.total}</Chip.Label>
          </Chip.Toggle>
        </li>
        {visible.map((gu) => (
          <li key={gu} className="shrink-0">
            <Chip.Toggle size="large" variant="outlineWeak" className={CHIP_CLASS} checked={selected.includes(gu)} onCheckedChange={(on) => toggle(gu, on)}>
              <Chip.Label>
                {gu} {counts.byDistrict[gu] ?? 0}
              </Chip.Label>
            </Chip.Toggle>
          </li>
        ))}
      </ul>
    </div>
  );
}
