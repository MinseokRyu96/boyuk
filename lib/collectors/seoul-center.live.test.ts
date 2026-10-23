import { describe, expect, it, vi } from "vitest";
import { isTarget } from "../normalize";
import { createHttpClient } from "./http";
import { createSeoulCenterCollector } from "./seoul-center";

/*
 * 실제 서울센터 사이트를 대상으로 구조가 그대로인지 확인한다. 기본 `npm test`에서는 건너뛴다.
 * 실행: npm run test:live  (robots.txt 1번 + 목록 2쪽, 모두 3번만 요청한다)
 * 사이트가 개편돼 수집이 깨졌는지 의심될 때 돌린다. 저장은 하지 않는다.
 */

vi.setConfig({ testTimeout: 60_000 });
const enabled = process.env.LIVE_TESTS === "1";

describe.skipIf(!enabled)("서울센터 수집기 — 실제 사이트 (읽기만)", () => {
  it("robots.txt가 허용하고, 목록 두 쪽을 공통 형식으로 읽는다", async () => {
    const collector = createSeoulCenterCollector({ http: createHttpClient({ minIntervalMs: 2000 }), maxPages: 2 });
    const { jobs, complete } = await collector.fetchJobs();

    expect(complete).toBe(false); // 2쪽만 읽었으니 일부다
    expect(jobs.length).toBeGreaterThanOrEqual(15);
    for (const job of jobs) {
      expect(job.sourceId).toMatch(/^\d+$/);
      expect(job.url).toBe(`https://seoul.childcare.go.kr/ccef/job/JobOfferSl.jsp?flag=Sl&JOSEQ=${job.sourceId}`);
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.title).not.toMatch(/\.\.\.$/); // 잘린 표 글자가 아니라 title 속성의 전체 제목을 읽었는지
      expect(job.orgName).toBeTruthy();
      expect(job.region).toMatch(/^서울/);
      if (job.deadline) expect(job.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const targets = jobs.filter(isTarget);
    console.log(`[live] 읽은 ${jobs.length}건 중 신입·담임 판별 통과 ${targets.length}건, 직장 유형 ${jobs.filter((j) => j.isWorkplace).length}건`);
    for (const job of jobs.slice(0, 12)) {
      console.log(`[live] ${isTarget(job) ? "저장" : "제외"} | ${job.deadline ?? "마감일 없음"} | ${job.region} | ${job.orgName} | ${job.title}`);
    }
  });
});
