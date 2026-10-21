import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./url";

describe("safeHttpUrl", () => {
  it("http와 https 주소는 그대로 통과시킨다 (쿼리도 유지)", () => {
    expect(safeHttpUrl("https://www.work24.go.kr/a?x=1&y=2")).toBe("https://www.work24.go.kr/a?x=1&y=2");
    expect(safeHttpUrl("http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1&utm_source=job-search-api")).toBe(
      "http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1&utm_source=job-search-api",
    );
  });

  it("상대 주소는 base를 기준으로 절대 주소로 바꾼다", () => {
    expect(safeHttpUrl("/wk/a?id=1", "https://www.work24.go.kr")).toBe("https://www.work24.go.kr/wk/a?id=1");
  });

  it("javascript:, data: 같은 위험한 주소는 버린다", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHttpUrl("ftp://example.com/a")).toBeUndefined();
  });

  it("비었거나 해석할 수 없으면 undefined", () => {
    expect(safeHttpUrl("")).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
  });
});
