/*
 * 수집기가 쓰는 HTTP 호출 도구: 시간 초과, 재시도(지수 백오프), 호출 간격 제한, 식별 가능한 User-Agent.
 * PRD 10장 "수집 예절"(요청 사이 1~2초 간격, 식별 가능한 User-Agent)을 코드로 강제한다.
 * 시계와 대기, fetch를 바깥에서 넣을 수 있게 해서 실제로 기다리지 않고 테스트한다.
 */

export const DEFAULT_USER_AGENT = "boyuk-collector/0.1 (+https://github.com/MinseokRyu96/boyuk)";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 오류 메시지·로그에 남기면 안 되는 URL 파라미터 */
const SECRET_PARAMS = ["authKey", "access-key", "accessKey", "serviceKey"];

/** URL의 인증키 값을 *** 로 가린다. 오류 메시지에는 반드시 이 함수를 거친 URL만 쓴다 */
export function redactUrl(url: string): string {
  const names = SECRET_PARAMS.join("|");
  return url.replace(new RegExp(`([?&](?:${names})=)[^&#]*`, "gi"), "$1***");
}

export class HttpError extends Error {
  constructor(
    message: string,
    /** 응답을 받지 못한 경우(네트워크 오류·시간 초과)는 null */
    readonly status: number | null,
    /** 인증키를 가린 URL */
    readonly url: string,
    readonly attempts: number,
    /** 응답 본문 앞부분. 출처가 오류 코드를 본문에 담아 줄 때 해석하는 데 쓴다 */
    readonly body?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "HttpError";
  }
}

export type HttpResponse = {
  status: number;
  body: string;
  headers: Headers;
  /** 성공까지 걸린 시도 횟수 (1이면 처음에 성공) */
  attempts: number;
};

export type RetryOptions = {
  /** 첫 시도를 뺀 재시도 횟수. 기본 3 */
  retries?: number;
  /** 첫 재시도 전 대기. 이후 두 배씩 늘어난다. 기본 1000ms */
  baseDelayMs?: number;
  /** 한 번의 대기 상한. 기본 15000ms */
  maxDelayMs?: number;
  /** 서버가 Retry-After로 이보다 오래 기다리라고 하면 기다리지 않고 포기한다. 기본 30000ms */
  maxRetryAfterMs?: number;
  /** 요청 한 번(본문 읽기까지)의 제한 시간. 기본 15000ms */
  timeoutMs?: number;
  /** 시도 직전에 호출된다. 호출 간격 제한을 건다 */
  beforeAttempt?: () => Promise<void>;
  fetch?: FetchLike;
  sleep?: Sleep;
  /** 0~1 난수. 대기 시간을 절반~전체 사이로 흩뜨린다 */
  random?: () => number;
  now?: () => number;
};

/** 다시 시도해 볼 만한 상태 코드: 시간 초과, 너무 많은 요청, 서버 쪽 일시 오류 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const BODY_SNIPPET_LENGTH = 500;

/** Retry-After 헤더(초 또는 HTTP 날짜)를 밀리초로 바꾼다. 없거나 읽을 수 없으면 undefined */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

type Attempt =
  | { ok: true; response: Omit<HttpResponse, "attempts"> }
  | { ok: false; error: HttpError; retryable: boolean; retryAfterMs?: number };

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 한 번 요청한다. 응답 본문까지 제한 시간 안에 읽는다.
 * 재시도할 수 있는 실패인지는 호출한 쪽이 판단하도록 결과로만 돌려준다.
 */
async function attemptOnce(
  url: string,
  init: RequestInit,
  attemptNumber: number,
  options: Required<Pick<RetryOptions, "timeoutMs" | "fetch" | "now">>,
): Promise<Attempt> {
  const safeUrl = redactUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`제한 시간(${options.timeoutMs}ms)을 넘겼어요`)), options.timeoutMs);
  try {
    const res = await options.fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    if (res.ok) {
      return { ok: true, response: { status: res.status, body, headers: res.headers } };
    }
    return {
      ok: false,
      retryable: RETRYABLE_STATUS.has(res.status),
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), options.now()),
      error: new HttpError(`HTTP ${res.status}: ${safeUrl}`, res.status, safeUrl, attemptNumber, body.slice(0, BODY_SNIPPET_LENGTH)),
    };
  } catch (cause) {
    const reason = controller.signal.aborted ? describe(controller.signal.reason) : describe(cause);
    return {
      ok: false,
      retryable: true,
      error: new HttpError(`요청에 실패했어요(${reason}): ${safeUrl}`, null, safeUrl, attemptNumber, undefined, { cause }),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET/POST 등 요청을 보내고 본문 문자열까지 돌려준다.
 * 재시도할 수 없는 응답(400·401·403·404 등)은 바로 오류를 던지고,
 * 시간 초과·네트워크 오류·429·5xx는 지수 백오프로 다시 시도한다.
 */
export async function fetchText(url: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<HttpResponse> {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 15_000,
    maxRetryAfterMs = 30_000,
    timeoutMs = 15_000,
    beforeAttempt,
    fetch: doFetch = (input, requestInit) => globalThis.fetch(input, requestInit),
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
  } = options;

  for (let attempt = 1; ; attempt++) {
    await beforeAttempt?.();
    const result = await attemptOnce(url, init, attempt, { timeoutMs, fetch: doFetch, now });
    if (result.ok) return { ...result.response, attempts: attempt };

    const { error, retryable, retryAfterMs } = result;
    if (!retryable || attempt > retries) throw error;
    if (retryAfterMs !== undefined && retryAfterMs > maxRetryAfterMs) {
      throw new HttpError(
        `서버가 ${Math.round(retryAfterMs / 1000)}초 뒤에 다시 시도하라고 해서 포기했어요: ${error.url}`,
        error.status,
        error.url,
        attempt,
        error.body,
      );
    }

    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    const jittered = backoff * (0.5 + random() * 0.5);
    await sleep(Math.max(jittered, retryAfterMs ?? 0));
  }
}

/**
 * 호출 시작 사이의 간격을 최소 minIntervalMs로 맞춘다.
 * 여러 곳에서 동시에 기다려도 자리를 순서대로 배정하므로 간격이 줄어들지 않는다.
 */
export function createRateLimiter(
  minIntervalMs: number,
  clock: { now?: () => number; sleep?: Sleep } = {},
): () => Promise<void> {
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? defaultSleep;
  let nextAllowedAt = 0;
  return async () => {
    const current = now();
    const startAt = Math.max(current, nextAllowedAt);
    nextAllowedAt = startAt + minIntervalMs;
    if (startAt > current) await sleep(startAt - current);
  };
}

export type HttpClientConfig = {
  /** 요청 시작 사이의 최소 간격. 기본 1500ms (PRD: 1~2초) */
  minIntervalMs?: number;
  userAgent?: string;
  retry?: Omit<RetryOptions, "beforeAttempt">;
};

export type HttpClient = {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse>;
};

/** 호출 간격 제한과 재시도를 합친 수집용 HTTP 클라이언트. 소스마다 하나씩 만들어 간격을 따로 관리한다 */
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  const { minIntervalMs = 1500, userAgent = DEFAULT_USER_AGENT, retry = {} } = config;
  const wait = createRateLimiter(minIntervalMs, { now: retry.now, sleep: retry.sleep });
  return {
    get(url, init = {}) {
      return fetchText(
        url,
        { method: "GET", headers: { "User-Agent": userAgent, ...init.headers } },
        { ...retry, beforeAttempt: wait },
      );
    },
  };
}
