import { describe, expect, it, vi } from "vitest";
import { HttpError, type HttpClient, type HttpResponse } from "./http";
import { CrawlNotAllowedError, assertRobotsAllows } from "./robots";

const TARGET = "https://example.org/board/list.jsp?page=1";
const ROBOTS = "https://example.org/robots.txt";

function ok(body: string): HttpResponse {
  return { status: 200, body, headers: new Headers(), attempts: 1 };
}

/** robots.txt 요청에 주어진 응답(또는 오류)을 돌려주는 가짜 클라이언트 */
function clientWith(reply: HttpResponse | Error) {
  const get = vi.fn(async (_url: string) => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { http: { get } as HttpClient, get };
}

describe("assertRobotsAllows", () => {
  it("해당 사이트의 /robots.txt 한 곳만 요청한다", async () => {
    const { http, get } = clientWith(ok("User-agent: *\nAllow: /\n"));
    await assertRobotsAllows(http, TARGET);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(ROBOTS);
  });

  it("robots.txt가 없으면(404) 제한이 없는 것으로 본다", async () => {
    const { http } = clientWith(new HttpError("HTTP 404", 404, ROBOTS, 1));
    await expect(assertRobotsAllows(http, TARGET)).resolves.toBeUndefined();
  });

  it("모든 로봇을 막으면 CrawlNotAllowedError", async () => {
    const { http } = clientWith(ok("User-agent: *\nDisallow: /\n"));
    await expect(assertRobotsAllows(http, TARGET)).rejects.toBeInstanceOf(CrawlNotAllowedError);
  });

  it("우리 이름(boyuk-collector)만 지목해서 막아도 따른다", async () => {
    const { http } = clientWith(ok("User-agent: *\nAllow: /\n\nUser-agent: boyuk-collector\nDisallow: /board/\n"));
    await expect(assertRobotsAllows(http, TARGET)).rejects.toThrow(/허용하지 않아서/);
  });

  it("다른 경로나 다른 로봇만 막았으면 통과한다", async () => {
    const { http } = clientWith(ok("User-agent: *\nDisallow: /admin/\n\nUser-agent: BadBot\nDisallow: /\n"));
    await expect(assertRobotsAllows(http, TARGET)).resolves.toBeUndefined();
  });

  it("서버 오류(5xx)나 네트워크 오류는 허용 여부를 모르므로 수집하지 않는다", async () => {
    const serverError = clientWith(new HttpError("HTTP 503", 503, ROBOTS, 4));
    await expect(assertRobotsAllows(serverError.http, TARGET)).rejects.toThrow(/robots\.txt를 확인하지 못해/);

    const network = clientWith(new HttpError("요청에 실패했어요", null, ROBOTS, 4));
    await expect(assertRobotsAllows(network.http, TARGET)).rejects.toThrow(/robots\.txt를 확인하지 못해/);
  });
});
