import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { MOAMAM_INTERMEDIATE_CA } from "./moamam-ca";
import { fetchMoamam } from "./moamam-http";

describe("모아맘 인증서 보완", () => {
  it("추가한 인증서는 Node가 신뢰하는 루트의 서명으로 검증되는 공개 중간 인증서다", () => {
    const intermediate = new X509Certificate(MOAMAM_INTERMEDIATE_CA);
    const issuer = rootCertificates.map((pem) => new X509Certificate(pem)).find((root) => intermediate.checkIssued(root));

    expect(intermediate.ca).toBe(true);
    expect(issuer).toBeDefined();
    expect(intermediate.verify(issuer!.publicKey)).toBe(true);
    expect(intermediate.fingerprint256).toBe("8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0");
  });

  it.each([
    "http://recruit.moamom.com/robots.txt",
    "https://recruit.moamom.com:8443/robots.txt",
    "https://recruit.moamom.com.example.com/robots.txt",
    "https://example.com/robots.txt",
  ])("전용 연결을 다른 출처에 사용하지 못한다: %s", async (url) => {
    await expect(fetchMoamam(url)).rejects.toThrow("모아맘 전용 연결");
  });
});
