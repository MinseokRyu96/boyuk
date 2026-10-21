import { CRON_SLUGS, SOURCES, type SourceCode } from "../sources";
import { createHttpClient } from "./http";
import { createSaraminCollector } from "./saramin";
import type { Collector } from "./types";
import { createWork24Collector } from "./work24";

/*
 * 소스별 수집기 등록부. 아직 구현하지 않은 소스는 `pending(...)`이고, 엔드포인트가 501을 돌려준다.
 * 크롤러는 사이트별 robots.txt와 이용약관을 확인한 뒤 같은 방식으로 바꿔 끼운다. (PRD 5장, 11장 3단계)
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
  // 인증키는 호출할 때 환경변수에서 읽는다. 없으면 수집 실패로 기록된다
  work24: createWork24Collector({ getAuthKey: () => process.env.WORK24_API_KEY, http: createHttpClient({ minIntervalMs: 1500 }) }),
  saramin: createSaraminCollector({ getAccessKey: () => process.env.SARAMIN_API_KEY, http: createHttpClient({ minIntervalMs: 1500 }) }),
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
