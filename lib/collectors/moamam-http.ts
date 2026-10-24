import { Pool } from "undici";
import { createHttpClient, type FetchLike } from "./http";
import { moamamTlsConnector } from "./moamam-tls";

const ORIGIN = "https://recruit.moamom.com";

// 인증서 보완과 고정한 인증서의 만료 예외는 이 출처의 연결에만 적용한다.
const pool = new Pool(ORIGIN, { connect: moamamTlsConnector });

export const fetchMoamam: FetchLike = async (input, init) => {
  if (new URL(input).origin !== ORIGIN) {
    throw new Error("모아맘 전용 연결은 https://recruit.moamom.com에서만 사용할 수 있어요.");
  }

  // 다른 출처나 HTTP로 이동하면서 전용 인증서 설정을 재사용하지 않도록 리다이렉트는 거부한다.
  const requestInit: RequestInit & { dispatcher: Pool } = {
    ...init,
    dispatcher: pool,
    redirect: "error",
    cache: "no-store",
  };
  return globalThis.fetch(input, requestInit);
};

/** 운영 수집과 실제 사이트 시험에서 같은 인증서·재시도·호출 간격을 사용한다. */
export function createMoamamHttpClient() {
  return createHttpClient({ minIntervalMs: 2000, retry: { fetch: fetchMoamam } });
}
