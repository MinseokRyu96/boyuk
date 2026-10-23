import { timingSafeEqual } from "node:crypto";

/** 크론 엔드포인트 호출자가 Vercel 크론(또는 CRON_SECRET을 아는 사람)인지 확인한다. 비밀 값이 없으면 항상 거부한다 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
