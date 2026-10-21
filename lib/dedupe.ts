import { createHash } from "node:crypto";
import { normalizeOrgName } from "./org-name";

export { normalizeOrgName };

/** 이름이 이것뿐이면 어린이집명을 알 수 없는 것으로 본다 */
const GENERIC_NAME = new Set(["어린이집", "직장어린이집", "국공립어린이집", "가정어린이집", "민간어린이집"]);

/**
 * 출처가 다른 같은 공고를 묶는 키: 해시(정규화한 어린이집명 + 마감일).
 * 어린이집명이 없거나 마감일이 없으면 null이다. 잘못 합치는 것이 중복 노출보다 나쁘므로,
 * 상시채용처럼 마감일로 같은 공고임을 확인할 수 없는 경우에도 합치지 않는다.
 */
export function dedupeKey(orgName?: string, deadline?: string): string | null {
  const name = normalizeOrgName(orgName);
  if (name.length < 2 || GENERIC_NAME.has(name) || !deadline) return null;
  return createHash("sha256").update(`${name}|${deadline}`).digest("hex").slice(0, 32);
}
