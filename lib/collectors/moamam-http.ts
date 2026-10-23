import { rootCertificates } from "node:tls";
import { Pool } from "undici";
import { createHttpClient, type FetchLike } from "./http";
import { MOAMAM_INTERMEDIATE_CA } from "./moamam-ca";

const ORIGIN = "https://recruit.moamom.com";

// 서버가 보내는 구형 중간 인증서 대신 올바른 발급자 인증서를 보완한다.
// Node의 기본 루트까지 이어지는 서명·유효기간·호스트 검증은 그대로 유지한다.
const pool = new Pool(ORIGIN, {
  connect: {
    ca: [...rootCertificates, MOAMAM_INTERMEDIATE_CA],
    rejectUnauthorized: true,
  },
});

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
