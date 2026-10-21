import { createHash } from "node:crypto";

/** 출처에 공고 ID가 없을 때 원문 URL의 해시를 ID로 쓴다 (PRD 7장) */
export function idFromUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 20);
}
