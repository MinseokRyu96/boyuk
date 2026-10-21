/**
 * 출처가 준 링크를 저장하기 전에 걸러낸다. http(s)만 허용한다.
 * 이 값은 화면에서 그대로 href가 되므로 javascript: 같은 주소가 섞여 들어오면 안 된다.
 * 상대 주소는 base를 기준으로 절대 주소로 바꾼다.
 */
export function safeHttpUrl(raw: string | undefined | null, base?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
