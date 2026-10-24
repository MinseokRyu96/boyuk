import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TLSSocket, type PeerCertificate } from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertMoamamCertificate, moamamTlsConnector } from "./moamam-tls";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  buildConnector: () => connect,
}));

// 공개 서버 인증서만 보관한다. 서버 비밀키는 없고, 시험에서도 네트워크에 연결하지 않는다.
const certificate = new X509Certificate(readFileSync(join(__dirname, "__fixtures__/moamam-server.crt")));
const peer = certificate.toLegacyObject();
const BEFORE_EXPIRY = Date.parse("2026-10-24T00:00:00Z");
const AFTER_EXPIRY = Date.parse("2026-10-30T00:00:00Z");

afterEach(() => vi.restoreAllMocks());

describe("모아맘 인증서의 제한적인 만료 예외", () => {
  it("보관한 공개 인증서는 기록한 도메인의 인증서이고, 정상 검증을 통과한 연결을 허용한다", () => {
    expect(certificate.checkHost("recruit.moamom.com")).toBe("recruit.moamom.com");
    expect(() => assertMoamamCertificate(peer, true, undefined, BEFORE_EXPIRY)).not.toThrow();
  });

  it("2026-10-30 이후에도 미리 확인한 서버 인증서 자체만 만료되었으면 허용한다", () => {
    expect(() => assertMoamamCertificate(peer, false, "CERT_HAS_EXPIRED", AFTER_EXPIRY)).not.toThrow();
    expect(() => assertMoamamCertificate(peer, false, { code: "CERT_HAS_EXPIRED" }, AFTER_EXPIRY)).not.toThrow();
  });

  it("같은 공개키라도 인증서의 내용이나 서명이 바뀌면 만료 예외를 거부한다", () => {
    const changed = Buffer.from(peer.raw);
    changed[changed.length - 1] ^= 1;
    const changedCertificate = new X509Certificate(changed);
    expect(changedCertificate.publicKey.equals(certificate.publicKey)).toBe(true);
    expect(() => assertMoamamCertificate({ ...peer, raw: changed }, false, "CERT_HAS_EXPIRED", AFTER_EXPIRY)).toThrow(
      expect.objectContaining({ code: "ERR_TLS_CERT_PIN_MISMATCH" }),
    );
  });

  it("갱신된 인증서가 정상 CA 검증을 통과하면 이전 고정 값으로 제한하지 않는다", () => {
    // authorized는 실제 TLS 연결이 CA 검증을 통과한 결과다. 정상 경로는 만료 예외의 raw 고정 값을 요구하지 않는다.
    expect(() => assertMoamamCertificate({ ...peer, raw: Buffer.alloc(0) }, true, undefined, BEFORE_EXPIRY)).not.toThrow();
  });

  it.each(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_REVOKED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID", undefined])(
    "고정 인증서라도 만료 외 오류(%s)는 허용하지 않는다",
    (error) => {
      expect(() => assertMoamamCertificate(peer, false, error, AFTER_EXPIRY)).toThrow();
    },
  );

  it.each([BEFORE_EXPIRY, Date.parse("2025-01-01T00:00:00Z"), NaN])("서버 인증서 자체가 만료되지 않은 시각(%s)에는 예외를 허용하지 않는다", (now) => {
    expect(() => assertMoamamCertificate(peer, false, "CERT_HAS_EXPIRED", now)).toThrow(
      expect.objectContaining({ code: "ERR_TLS_CERT_NOT_EXPIRED" }),
    );
  });

  it("중간 인증서까지 만료되면 고정 서버 인증서라도 거부한다", () => {
    expect(() => assertMoamamCertificate(peer, false, "CERT_HAS_EXPIRED", Date.parse("2037-01-01T00:00:00Z"))).toThrow(
      expect.objectContaining({ code: "ERR_TLS_CERT_CHAIN_INVALID" }),
    );
  });

  it.each([true, false])("CA 검증 결과(%s)와 무관하게 도메인이 다르면 거부한다", (authorized) => {
    const wrongHost = { ...peer, subjectaltname: "DNS:example.com", subject: { CN: "example.com" } };
    expect(() => assertMoamamCertificate(wrongHost, authorized, "CERT_HAS_EXPIRED", AFTER_EXPIRY)).toThrow(
      expect.objectContaining({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
    );
  });
});

const options = { hostname: "recruit.moamom.com", protocol: "https:", port: "443" };

function fakeSocket(cert: PeerCertificate = peer, error = "CERT_HAS_EXPIRED") {
  return Object.assign(Object.create(TLSSocket.prototype) as TLSSocket, {
    authorized: false,
    authorizationError: error,
    getPeerCertificate: () => cert,
    destroy: vi.fn(),
  });
}

describe("HTTP 요청 전에 TLS 연결 검증", () => {
  beforeEach(() => {
    connect.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(AFTER_EXPIRY);
  });

  it("고정 인증서의 만료 예외를 확인한 연결만 HTTP 클라이언트에 넘긴다", () => {
    const socket = fakeSocket();
    connect.mockImplementation((_options, done) => done(null, socket));
    const done = vi.fn();
    moamamTlsConnector(options, done);
    expect(done).toHaveBeenCalledExactlyOnceWith(null, socket);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it("다른 인증서는 소켓을 먼저 닫고 오류를 돌려주므로 HTTP 요청을 보낼 수 없다", () => {
    const changed = Buffer.from(peer.raw);
    changed[changed.length - 1] ^= 1;
    const socket = fakeSocket({ ...peer, raw: changed });
    connect.mockImplementation((_options, done) => done(null, socket));
    const done = vi.fn(() => expect(socket.destroy).toHaveBeenCalledOnce());
    moamamTlsConnector(options, done);
    expect(done).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "ERR_TLS_CERT_PIN_MISMATCH" }), null);
  });

  it("인증서를 읽을 수 없는 소켓도 닫고 거부한다", () => {
    const socket = fakeSocket({} as PeerCertificate);
    connect.mockImplementation((_options, done) => done(null, socket));
    const done = vi.fn();
    moamamTlsConnector(options, done);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledExactlyOnceWith(expect.any(Error), null);
  });

  it.each([
    { ...options, hostname: "example.com" },
    { ...options, protocol: "http:" },
    { ...options, port: "8443" },
    { ...options, servername: "example.com" },
  ])("다른 출처로는 TLS 연결도 시도하지 않는다: %j", (target) => {
    const done = vi.fn();
    moamamTlsConnector(target, done);
    expect(connect).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "ERR_TLS_ORIGIN_NOT_ALLOWED" }), null);
  });

  it("네트워크 오류는 그대로 돌려주고 승인 소켓을 만들지 않는다", () => {
    const error = new Error("연결 실패");
    connect.mockImplementation((_options, done) => done(error, null));
    const done = vi.fn();
    moamamTlsConnector(options, done);
    expect(done).toHaveBeenCalledExactlyOnceWith(error, null);
  });
});
