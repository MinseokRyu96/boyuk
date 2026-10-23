import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { createHttpClient } from "./http";
import { createSamsungCollector } from "./samsung";

/*
 * 실제 삼성복지재단 채용사이트를 대상으로 구조가 그대로인지 확인한다. 기본 `npm test`에서는 건너뛴다.
 * 실행: npm run test:live  (목록 첫 쪽 1번만 요청한다. 저장은 하지 않는다)
 * robots.txt가 전체 금지라서 robots.txt를 무시하는 옵션을 켜고 읽는다 (samsung.ts 머리 주석 참고).
 */

vi.setConfig({ testTimeout: 60_000 });
const enabled = process.env.LIVE_TESTS === "1";

describe.skipIf(!enabled)("삼성 수집기 — 실제 사이트 (읽기만)", () => {
  it("목록 첫 쪽을 공통 형식으로 읽는다", async () => {
    const collector = createSamsungCollector({ http: createHttpClient({ minIntervalMs: 2000 }), ignoreRobotsTxt: true, maxPages: 1 });
    const { jobs } = await collector.fetchJobs();

    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.sourceId).toMatch(/^\d+$/);
      expect(job.url).toMatch(/^https:\/\/www\.samsungwelfare\.org\/html\/welfare\/nursery\/recruit_view\.asp\?seq=\d+&page=\d+&prc_seq=view$/);
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.orgName).toBeTruthy();
      expect(job.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    console.log(`[live] 읽은 ${jobs.length}건 중 신입·담임 판별 통과 ${jobs.filter(isTarget).length}건`);
  });
});
