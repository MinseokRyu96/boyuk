import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { createHttpClient } from "./http";
import { createPuruniCollector } from "./puruni";

/*
 * 실제 푸르니 채용사이트를 대상으로 구조가 그대로인지 확인한다. 기본 `npm test`에서는 건너뛴다.
 * 실행: npm run test:live  (목록 첫 쪽 1번만 요청한다. 저장은 하지 않는다)
 * 푸르니는 robots.txt가 전체 금지라서 robots.txt를 무시하는 옵션을 켜고 읽는다 (puruni.ts 머리 주석 참고).
 */

vi.setConfig({ testTimeout: 60_000 });
const enabled = process.env.LIVE_TESTS === "1";

describe.skipIf(!enabled)("푸르니 수집기 — 실제 사이트 (읽기만)", () => {
  it("목록 첫 쪽을 공통 형식으로 읽는다", async () => {
    const collector = createPuruniCollector({ http: createHttpClient({ minIntervalMs: 2000 }), ignoreRobotsTxt: true, maxPages: 1 });
    const { jobs } = await collector.fetchJobs();

    // 접수 중인 공고만 올라오는 작은 게시판이라 0건일 수도 있다. 0건이면 구조 오류로 이미 위에서 던졌다
    for (const job of jobs) {
      expect(job.sourceId).toMatch(/^\d+$/);
      expect(job.url).toMatch(/^https:\/\/recruit\.puruni\.com\/recruit\/notice\/view\?page=\d+&idx=\d+$/);
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    console.log(`[live] 읽은 ${jobs.length}건 중 신입·담임 판별 통과 ${jobs.filter(isTarget).length}건`);
  });
});
