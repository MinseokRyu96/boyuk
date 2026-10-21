import { CRON_SLUGS, SOURCES, type SourceCode } from "../sources";
import type { Collector } from "./types";

/*
 * 소스별 수집기 등록부. 외부 API·사이트의 요청/응답 형식은 각 공식 문서와 약관·robots.txt를 확인한 뒤
 * 이 파일의 `pending(...)`을 실제 수집기로 바꿔 끼운다. (PRD 5장, 11장 2·3단계)
 */

/** 아직 구현하지 않은 수집기. 엔드포인트는 501을 돌려주고 collector_runs에는 기록하지 않는다 */
function pending(source: SourceCode): Collector {
  return {
    source,
    isWorkplace: SOURCES[source].isWorkplace,
    implemented: false,
    async fetchJobs() {
      throw new Error(`${source} 수집기는 아직 구현되지 않았어요.`);
    },
  };
}

const COLLECTORS: Record<SourceCode, Collector> = {
  work24: pending("work24"),
  saramin: pending("saramin"),
  seoul_center: pending("seoul_center"),
  moamam: pending("moamam"),
  purunee: pending("purunee"),
  hansol: pending("hansol"),
  samsung: pending("samsung"),
};

/** /api/cron/[source]의 주소 값으로 수집기를 찾는다. 알 수 없는 값이면 undefined */
export function findCollector(slug: string): Collector | undefined {
  const code = Object.hasOwn(CRON_SLUGS, slug) ? CRON_SLUGS[slug] : undefined;
  return code ? COLLECTORS[code] : undefined;
}
