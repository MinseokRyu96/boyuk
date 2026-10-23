import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { createHansolCollector } from "./hansol";
import { createHttpClient } from "./http";

/*
 * 실제 한솔 채용사이트를 대상으로 구조가 그대로인지 확인한다. 기본 `npm test`에서는 건너뛴다.
 * 실행: npm run test:live  (robots.txt 1번 + 접수 중 목록 첫 쪽 1번, 모두 2번만 요청한다. 저장은 하지 않는다)
 */

vi.setConfig({ testTimeout: 60_000 });
const enabled = process.env.LIVE_TESTS === "1";

describe.skipIf(!enabled)("한솔 수집기 — 실제 사이트 (읽기만)", () => {
  it("robots.txt가 허용하고, 접수 중 목록 첫 쪽을 공통 형식으로 읽는다", async () => {
    const collector = createHansolCollector({ http: createHttpClient({ minIntervalMs: 2000 }), maxPages: 1 });
    const { jobs } = await collector.fetchJobs();

    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.sourceId).toMatch(/^\d+$/);
      expect(job.url).toBe(`https://docu.hansolhope.or.kr/recruit/index.do?flg=view&mCurrent=2&sCurrent=3&empmn_sn=${job.sourceId}`);
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/); // 접수 중 공고에는 접수 기간이 있다
    }
    console.log(`[live] 읽은 ${jobs.length}건 중 신입·담임 판별 통과 ${jobs.filter(isTarget).length}건`);
  });
});
