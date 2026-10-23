"use client";

import { Chip } from "seed-design/ui/chip";
import { ACTIVE_SOURCES, SOURCES, type SourceCode } from "@/lib/sources";
import type { FeedCounts } from "@/lib/types";

type Props = {
  counts: FeedCounts;
  selected: readonly SourceCode[];
  onChange: (next: SourceCode[]) => void;
};

/** SEED 칩의 가장 큰 크기(large)가 40px이라, 터치 영역 기준(44px)에 맞추려고 높이를 키운다 */
const CHIP_CLASS = "min-h-11";

const ALL_SOURCES = Object.keys(SOURCES) as SourceCode[];

/**
 * 플랫폼(수집 출처)별 필터. "모든 플랫폼"과 서울시센터·한솔·푸르니·삼성 같은 출처를 가로로 늘어놓고, 여러 개를 함께 고를 수 있다.
 * 지금 수집하는 출처(ACTIVE_SOURCES)는 공고가 0건이어도 칩을 보여 주되 누를 수 없게 해서,
 * "수집은 하는데 지금 공고가 없는 것"과 "수집하지 않는 것"을 구분한다.
 */
export function SourceFilter({ counts, selected, onChange }: Props) {
  const visible = ALL_SOURCES.filter((code) => ACTIVE_SOURCES.includes(code) || (counts.bySource[code] ?? 0) > 0 || selected.includes(code));

  const toggle = (code: SourceCode, on: boolean) => onChange(ALL_SOURCES.filter((name) => (name === code ? on : selected.includes(name))));

  return (
    <ul role="group" aria-label="플랫폼 선택" className="flex gap-x2 overflow-x-auto px-x4 pb-x1 pt-x3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <li className="shrink-0">
        <Chip.Toggle size="large" variant="outlineWeak" className={CHIP_CLASS} checked={selected.length === 0} onCheckedChange={() => onChange([])}>
          <Chip.Label>모든 플랫폼</Chip.Label>
        </Chip.Toggle>
      </li>
      {visible.map((code) => {
        const count = counts.bySource[code] ?? 0;
        const isSelected = selected.includes(code);
        return (
          <li key={code} className="shrink-0">
            <Chip.Toggle
              size="large"
              variant="outlineWeak"
              className={CHIP_CLASS}
              checked={isSelected}
              disabled={count === 0 && !isSelected}
              onCheckedChange={(on) => toggle(code, on)}
            >
              <Chip.Label>
                {SOURCES[code].label} {count}
              </Chip.Label>
            </Chip.Toggle>
          </li>
        );
      })}
    </ul>
  );
}
