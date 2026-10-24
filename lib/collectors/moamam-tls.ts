import { X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates, TLSSocket, type PeerCertificate } from "node:tls";
import { buildConnector } from "undici";
import { MOAMAM_INTERMEDIATE_CA } from "./moamam-ca";

const HOSTNAME = "recruit.moamom.com";
// 2026-10-24에 유효한 CA 서명·도메인을 확인한 서버 인증서 전체의 SHA-256이다.
// 공개키만 같아도 허용하는 것보다 좁게, 이 인증서 그대로 만료된 경우에만 예외를 둔다.
const PINNED_FINGERPRINT = "62:78:E3:F0:95:BE:A6:9D:D1:B9:54:D3:76:D1:DD:58:03:CA:90:F1:09:DB:6F:B5:2F:39:57:6A:4E:43:13:61";
const intermediate = new X509Certificate(MOAMAM_INTERMEDIATE_CA);
const root = rootCertificates
  .map((pem) => new X509Certificate(pem))
  .find((candidate) => intermediate.checkIssued(candidate) && intermediate.verify(candidate.publicKey));

function errorCode(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
}

function tlsError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function validAt(cert: X509Certificate, now: number): boolean {
  return Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo);
}

/** HTTP 요청을 보내기 전에 호출한다. 만료 외 오류와 확인한 인증서가 아닌 연결은 허용하지 않는다. */
export function assertMoamamCertificate(
  peer: PeerCertificate,
  authorized: boolean,
  authorizationError: unknown,
  now = Date.now(),
): void {
  // 만료된 인증서는 Node가 호스트 검사를 건너뛰므로 여기서 반드시 다시 확인한다.
  const identityError = checkServerIdentity(HOSTNAME, peer);
  if (identityError) throw identityError;
  // 정상적으로 갱신된 인증서는 고정 값과 달라도 일반 CA 검증을 통과하면 사용할 수 있다.
  if (authorized) return;

  const code = errorCode(authorizationError);
  if (code !== "CERT_HAS_EXPIRED") {
    throw tlsError(code ?? "ERR_TLS_CERT_INVALID", "모아맘 인증서 검증에 실패했어요. 만료 외 오류는 예외로 허용하지 않아요.");
  }

  const cert = new X509Certificate(peer.raw);
  if (cert.fingerprint256 !== PINNED_FINGERPRINT) {
    throw tlsError("ERR_TLS_CERT_PIN_MISMATCH", "모아맘 인증서가 미리 확인한 인증서와 달라서 만료 예외를 적용하지 않았어요.");
  }
  if (!Number.isFinite(now) || !(Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) < now)) {
    throw tlsError("ERR_TLS_CERT_NOT_EXPIRED", "서버 인증서 자체가 만료된 경우에만 예외를 허용해요.");
  }
  // OpenSSL이 보고한 첫 오류 뒤에 다른 체인 오류가 숨어 있어도 허용하지 않는다.
  // 고정한 서버 인증서의 발급자와 서명을 재확인하고, 중간·루트 인증서는 여전히 유효해야 한다.
  if (!root || !validAt(intermediate, now) || !validAt(root, now) || !cert.checkIssued(intermediate) || !cert.verify(intermediate.publicKey)) {
    throw tlsError("ERR_TLS_CERT_CHAIN_INVALID", "모아맘 발급기관 인증서의 서명이나 유효기간을 확인하지 못했어요.");
  }
}

// 이 연결 하나에서만 TLS 핸드셰이크 결과를 직접 검사한다. 아래 검증이 끝나야
// 소켓을 HTTP 클라이언트에 넘기므로, 거부한 연결에는 요청·헤더·본문을 보내지 않는다.
const connectTls = buildConnector({
  ca: [...rootCertificates, MOAMAM_INTERMEDIATE_CA],
  rejectUnauthorized: false,
  // 세션을 재사용해 인증서 확인을 건너뛰는 일이 없도록 매 연결마다 다시 검사한다.
  maxCachedSessions: 0,
});

export const moamamTlsConnector: buildConnector.connector = (options, callback) => {
  if (options.protocol !== "https:" || options.hostname !== HOSTNAME || (options.port && options.port !== "443") || (options.servername && options.servername !== HOSTNAME) || options.httpSocket) {
    callback(tlsError("ERR_TLS_ORIGIN_NOT_ALLOWED", "모아맘 만료 예외는 https://recruit.moamom.com:443에서만 사용할 수 있어요."), null);
    return;
  }

  connectTls({ ...options, servername: HOSTNAME }, (error, socket) => {
    if (error) {
      callback(error, null);
      return;
    }
    try {
      if (!(socket instanceof TLSSocket)) throw tlsError("ERR_TLS_REQUIRED", "모아맘 연결은 TLS를 사용해야 해요.");
      assertMoamamCertificate(socket.getPeerCertificate(), socket.authorized, socket.authorizationError);
    } catch (cause) {
      socket.destroy();
      callback(cause instanceof Error ? cause : new Error(String(cause)), null);
      return;
    }
    callback(null, socket);
  });
};
