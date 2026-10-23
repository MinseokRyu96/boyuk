import robotsParser from "robots-parser";
import { HttpError, type HttpClient } from "./http";

/*
 * 크롤러가 요청을 보내기 전에 robots.txt가 그 주소를 허용하는지 확인한다 (PRD 5장·10장).
 * 사이트가 나중에 수집을 막아도 수집기가 알아서 멈추도록, 실행할 때마다 확인한다.
 * 판단은 RFC 9309를 따른다: 2xx면 규칙을 읽고, 4xx(파일 없음)이면 제한 없음, 5xx·네트워크 오류면 알 수 없으므로 수집하지 않는다.
 */

/** robots.txt에서 우리를 가리키는 이름 (User-Agent의 제품 이름) */
export const ROBOTS_PRODUCT_TOKEN = "boyuk-collector";

/** robots.txt가 수집을 막고 있을 때. 수집기는 요청을 더 보내지 않고 이 오류로 실패한다 */
export class CrawlNotAllowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt가 이 주소의 수집을 허용하지 않아서 요청하지 않았어요: ${url}`);
    this.name = "CrawlNotAllowedError";
  }
}

/** targetUrl이 속한 사이트의 robots.txt를 읽어 수집이 허용되는지 확인한다. 허용되지 않으면 CrawlNotAllowedError */
export async function assertRobotsAllows(http: HttpClient, targetUrl: string): Promise<void> {
  const robotsUrl = new URL("/robots.txt", targetUrl).toString();

  let body: string;
  try {
    body = (await http.get(robotsUrl)).body;
  } catch (cause) {
    // 4xx는 robots.txt가 없다는 뜻이라 제한이 없다 (404가 보통이다)
    if (cause instanceof HttpError && cause.status !== null && cause.status >= 400 && cause.status < 500) return;
    // 서버 오류나 네트워크 오류는 허용 여부를 알 수 없다. 모르면 수집하지 않는다
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`robots.txt를 확인하지 못해 수집을 건너뛰었어요: ${reason}`, { cause });
  }

  const allowed = robotsParser(robotsUrl, body).isAllowed(targetUrl, ROBOTS_PRODUCT_TOKEN);
  // 같은 사이트의 주소가 아니면 undefined가 돌아온다. 확인하지 못한 것이므로 허용하지 않는다
  if (allowed !== true) throw new CrawlNotAllowedError(targetUrl);
}
