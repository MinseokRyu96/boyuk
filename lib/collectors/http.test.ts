import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_AGENT,
  HttpError,
  createHttpClient,
  createRateLimiter,
  fetchText,
  parseRetryAfter,
  redactUrl,
} from "./http";

const respond = (status: number, body = "", headers: Record<string, string> = {}) => new Response(body, { status, headers });

/** 준비한 응답(또는 오류)을 차례로 돌려주는 가짜 fetch */
function scripted(...items: (Response | Error)[]) {
  const queue = [...items];
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const item = queue.shift();
    if (!item) throw new Error("준비한 응답을 모두 썼어요");
    if (item instanceof Error) throw item;
    return item;
  });
}

/** 실제로 기다리지 않고, 대기 시간만 기록하는 도구. random이 1이면 백오프가 줄어들지 않는다 */
function instant() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms), random: () => 1 };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("redactUrl", () => {
  it("인증키 값을 가리고 나머지 파라미터는 그대로 둔다", () => {
    const url = "https://example.com/api?authKey=SECRET123&keyword=%EB%B3%B4%EC%9C%A1&access-key=TOP-SECRET";
    const safe = redactUrl(url);
    expect(safe).not.toContain("SECRET123");
    expect(safe).not.toContain("TOP-SECRET");
    expect(safe).toContain("authKey=***");
    expect(safe).toContain("access-key=***");
    expect(safe).toContain("keyword=%EB%B3%B4%EC%9C%A1");
  });

  it("인증키가 맨 앞 파라미터이거나 대소문자가 달라도 가린다", () => {
    expect(redactUrl("https://x.test/a?AUTHKEY=abc&b=1")).toBe("https://x.test/a?AUTHKEY=***&b=1");
    expect(redactUrl("https://x.test/a?b=1&authKey=abc")).toBe("https://x.test/a?b=1&authKey=***");
  });
});

describe("parseRetryAfter", () => {
  it("초 단위와 날짜 형식을 밀리초로 바꾼다", () => {
    expect(parseRetryAfter("3", 0)).toBe(3000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:05 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(5000);
  });

  it("없거나 읽을 수 없으면 undefined", () => {
    expect(parseRetryAfter(null, 0)).toBeUndefined();
    expect(parseRetryAfter("곧", 0)).toBeUndefined();
  });
});

describe("fetchText", () => {
  it("처음에 성공하면 본문과 시도 횟수 1을 돌려준다", async () => {
    const fetch = scripted(respond(200, "<ok/>"));
    const res = await fetchText("https://x.test/a", {}, { fetch });
    expect(res).toMatchObject({ status: 200, body: "<ok/>", attempts: 1 });
  });

  it("5xx는 지수 백오프로 다시 시도해 성공하면 결과를 돌려준다", async () => {
    const t = instant();
    const fetch = scripted(respond(500), respond(503), respond(200, "성공"));
    const res = await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep, random: t.random, baseDelayMs: 1000 });
    expect(res.body).toBe("성공");
    expect(res.attempts).toBe(3);
    expect(t.sleeps).toEqual([1000, 2000]);
  });

  it("대기 시간은 상한을 넘지 않는다", async () => {
    const t = instant();
    const fetch = scripted(respond(500), respond(500), respond(500), respond(200));
    await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep, random: t.random, baseDelayMs: 4000, maxDelayMs: 5000, retries: 3 });
    expect(t.sleeps).toEqual([4000, 5000, 5000]);
  });

  it("재시도 대상이 아닌 응답(404)은 한 번만 호출하고 바로 오류를 던진다", async () => {
    const t = instant();
    const fetch = scripted(respond(404, "찾을 수 없음"));
    const error = await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, attempts: 1, body: "찾을 수 없음" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(t.sleeps).toEqual([]);
  });

  it("429의 Retry-After가 백오프보다 길면 그만큼 기다린다", async () => {
    const t = instant();
    const fetch = scripted(respond(429, "", { "retry-after": "5" }), respond(200, "ok"));
    await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep, random: t.random, baseDelayMs: 1000 });
    expect(t.sleeps).toEqual([5000]);
  });

  it("Retry-After가 너무 길면 기다리지 않고 포기한다", async () => {
    const t = instant();
    const fetch = scripted(respond(503, "", { "retry-after": "600" }), respond(200, "ok"));
    const error = await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep, maxRetryAfterMs: 30_000 }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).toContain("포기");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(t.sleeps).toEqual([]);
  });

  it("재시도 횟수를 다 쓰면 마지막 오류를 던진다 (첫 시도 + retries번)", async () => {
    const t = instant();
    const fetch = scripted(respond(500), respond(500), respond(500));
    const error = await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep, random: t.random, retries: 2 }).catch((e) => e);
    expect(error).toMatchObject({ status: 500, attempts: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("네트워크 오류도 다시 시도하고, 끝내 실패하면 원인을 cause로 남긴다", async () => {
    const t = instant();
    const fetch = scripted(new TypeError("fetch failed"), respond(200, "ok"));
    const res = await fetchText("https://x.test/a", {}, { fetch, sleep: t.sleep, random: t.random });
    expect(res.attempts).toBe(2);

    const failing = scripted(new TypeError("fetch failed"), new TypeError("fetch failed"));
    const error = await fetchText("https://x.test/a", {}, { fetch: failing, sleep: t.sleep, random: t.random, retries: 1 }).catch((e) => e);
    expect(error).toMatchObject({ status: null, attempts: 2 });
    expect((error as HttpError).cause).toBeInstanceOf(TypeError);
  });

  it("오류 메시지와 URL에 인증키가 남지 않는다", async () => {
    const fetch = scripted(respond(403, "denied"));
    const error = (await fetchText("https://x.test/a?authKey=SUPER-SECRET&q=1", {}, { fetch }).catch((e) => e)) as HttpError;
    expect(error.message).not.toContain("SUPER-SECRET");
    expect(error.url).not.toContain("SUPER-SECRET");
    expect(error.url).toContain("authKey=***");
  });

  it("제한 시간 안에 응답이 없으면 요청을 취소하고 오류로 다룬다", async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    const pending = fetchText("https://x.test/a", {}, { fetch: hang, retries: 0, timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toThrow(/제한 시간\(5000ms\)/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("시간 초과도 재시도 대상이라 다음 시도가 성공하면 결과를 돌려준다", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const flaky = vi.fn((_url: string, init?: RequestInit) => {
      calls++;
      if (calls > 1) return Promise.resolve(respond(200, "두 번째는 성공"));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    const t = instant();
    const pending = fetchText("https://x.test/a", {}, { fetch: flaky, sleep: t.sleep, random: t.random, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ body: "두 번째는 성공", attempts: 2 });
  });
});

describe("createRateLimiter", () => {
  function fakeClock() {
    let t = 10_000;
    return { now: () => t, sleep: async (ms: number) => void (t += ms), at: () => t };
  }

  it("첫 호출은 기다리지 않고, 너무 빨리 부른 호출은 간격이 찰 때까지 기다린다", async () => {
    const clock = fakeClock();
    const wait = createRateLimiter(1500, clock);
    const start = clock.at();
    await wait();
    expect(clock.at() - start).toBe(0);
    await wait();
    expect(clock.at() - start).toBe(1500);
  });

  it("이미 간격이 지났으면 기다리지 않는다", async () => {
    const clock = fakeClock();
    const wait = createRateLimiter(1500, clock);
    await wait();
    await clock.sleep(5000);
    const before = clock.at();
    await wait();
    expect(clock.at() - before).toBe(0);
  });

  it("동시에 여러 곳에서 기다려도 호출 시작 간격이 줄지 않는다", async () => {
    const sleeps: number[] = [];
    // 대기해도 시계가 흐르지 않는 상황을 흉내 내서, 동시에 부른 호출이 자리를 순서대로 받는지 본다
    const t = 0;
    const wait = createRateLimiter(1000, { now: () => t, sleep: async (ms) => void sleeps.push(ms) });
    await Promise.all([wait(), wait(), wait()]);
    expect(sleeps).toEqual([1000, 2000]);
  });
});

describe("createHttpClient", () => {
  it("식별 가능한 User-Agent를 붙인다", async () => {
    const fetch = scripted(respond(200, "ok"));
    await createHttpClient({ retry: { fetch } }).get("https://x.test/a", { headers: { Accept: "application/json" } });
    const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(DEFAULT_USER_AGENT);
    expect(headers.Accept).toBe("application/json");
    expect(DEFAULT_USER_AGENT).toMatch(/^boyuk-collector\/.+\(\+https:\/\//);
  });

  it("재시도할 때도 호출 간격을 지킨다", async () => {
    let t = 0;
    const calledAt: number[] = [];
    const fetch = vi.fn(async () => {
      calledAt.push(t);
      return calledAt.length === 1 ? respond(500) : respond(200, "ok");
    });
    const client = createHttpClient({
      minIntervalMs: 1500,
      retry: { fetch, now: () => t, sleep: async (ms) => void (t += ms), random: () => 1, baseDelayMs: 100 },
    });
    await client.get("https://x.test/a");
    // 100ms 백오프 뒤에 다시 시도하려 해도, 직전 호출로부터 1500ms가 지나야 시작한다
    expect(calledAt).toEqual([0, 1500]);
  });
});
