import { CRON_SLUGS, type SourceCode } from "../sources";
import { createHansolCollector } from "./hansol";
import { createHttpClient } from "./http";
import { createMoamamCollector } from "./moamam";
import { createPuruniCollector } from "./puruni";
import { createSamsungCollector } from "./samsung";
import { createSaraminCollector } from "./saramin";
import { createSeoulCenterCollector } from "./seoul-center";
import type { Collector } from "./types";
import { createWork24Collector } from "./work24";

/*
 * 소스별 수집기 등록부. 새 소스를 구현하지 못했을 때는 `implemented: false`인 수집기를 두면 엔드포인트가 501을 돌려준다.
 * 크롤러는 사이트별 robots.txt와 이용약관을 확인한 뒤 연결한다. (PRD 5장, 11장 3단계)
 * 크롤러는 실행할 때마다 robots.txt를 다시 확인하고, 막혀 있으면 요청을 보내지 않고 실패로 기록한다.
 */

const COLLECTORS: Record<SourceCode, Collector> = {
  // 인증키는 호출할 때 환경변수에서 읽는다. 없으면 수집 실패로 기록된다
  work24: createWork24Collector({ getAuthKey: () => process.env.WORK24_API_KEY, http: createHttpClient({ minIntervalMs: 1500 }) }),
  saramin: createSaraminCollector({ getAccessKey: () => process.env.SARAMIN_API_KEY, http: createHttpClient({ minIntervalMs: 1500 }) }),
  // 크롤러는 사이트에 부담을 주지 않도록 요청 사이를 2초 띄운다
  seoul_center: createSeoulCenterCollector({ http: createHttpClient({ minIntervalMs: 2000 }) }),
  moamam: createMoamamCollector({ http: createHttpClient({ minIntervalMs: 2000 }) }),
  // 푸르니는 robots.txt가 전체 금지다. 소수 지인용 비영리 서비스라는 사용자의 판단으로 이 사이트만 robots.txt를 무시한다.
  // 끄려면 ignoreRobotsTxt를 지우면 된다(그러면 수집이 CrawlNotAllowedError로 멈춘다). 자세한 이유는 puruni.ts 머리 주석.
  purunee: createPuruniCollector({ http: createHttpClient({ minIntervalMs: 2000 }), ignoreRobotsTxt: true }),
  hansol: createHansolCollector({ http: createHttpClient({ minIntervalMs: 2000 }) }),
  // 삼성복지재단도 robots.txt가 전체 금지다. 푸르니와 같은 이유로 이 사이트도 robots.txt를 무시한다 (samsung.ts 머리 주석).
  samsung: createSamsungCollector({ http: createHttpClient({ minIntervalMs: 2000 }), ignoreRobotsTxt: true }),
};

/** /api/cron/[source]의 주소 값으로 수집기를 찾는다. 알 수 없는 값이면 undefined */
export function findCollector(slug: string): Collector | undefined {
  const code = Object.hasOwn(CRON_SLUGS, slug) ? CRON_SLUGS[slug] : undefined;
  return code ? COLLECTORS[code] : undefined;
}
