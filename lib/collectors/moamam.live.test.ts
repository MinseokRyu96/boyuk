import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { createHttpClient } from "./http";
import { createMoamamCollector } from "./moamam";

/*
 * 실제 모아맘 채용사이트를 대상으로 구조가 그대로인지 확인한다. 기본 `npm test`에서는 건너뛴다.
 * 실행: npm run test:live  (robots.txt 1번 + 두 게시판의 첫 쪽, 모두 3번만 요청한다. 저장은 하지 않는다)
 */

vi.setConfig({ testTimeout: 60_000 });
const enabled = process.env.LIVE_TESTS === "1";

describe.skipIf(!enabled)("모아맘 수집기 — 실제 사이트 (읽기만)", () => {
  it("robots.txt가 허용하고, 두 게시판의 첫 쪽을 공통 형식으로 읽는다", async () => {
    const collector = createMoamamCollector({ http: createHttpClient({ minIntervalMs: 2000 }), maxPages: 1 });
    const { jobs, complete } = await collector.fetchJobs();

    expect(complete).toBe(false); // 첫 쪽만 읽었다
    expect(jobs.length).toBeGreaterThan(0);
    const types = new Set(jobs.map((job) => job.sourceId.split("-")[0]));
    expect(types).toEqual(new Set(["1", "2"])); // 교직원채용(1)과 정기채용(2) 모두에서 접수 중 공고가 있다
    for (const job of jobs) {
      expect(job.sourceId).toMatch(/^[12]-\d+$/);
      expect(job.url).toMatch(/^https:\/\/recruit\.moamom\.com\/recruitment\/(staff|regular)-view\.php\?type=[12]&mode=view&idx=\d+$/);
      expect(job.title).toMatch(/^\[.+\]/); // 제목은 "[지역] ..."로 시작한다
      expect(job.orgName).toBeTruthy();
      expect(job.region).toBeTruthy();
      expect(job.careerHint).toBeDefined();
      if (job.deadline) expect(job.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    console.log(`[live] 읽은 ${jobs.length}건 중 신입·담임 판별 통과 ${jobs.filter(isTarget).length}건`);
  });
});
