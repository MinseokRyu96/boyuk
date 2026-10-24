/*
 * 지도 핀과 클러스터(숫자로 묶인 원)의 모양. 카카오 기본 파란 핀 대신 브랜드 청록을 쓴다.
 * 유아이볼에서 본 지도 앱들(자리톡·다방의 숫자 원, 캐시워크·바나프레소의 색 핀)을 참고했다:
 *  - 핀: 청록 물방울 안에 흰 원. 한 어린이집에 공고가 여럿이면 흰 원 안에 건수를 쓴다(10건부터 "9+")
 *  - 고른 핀: 한 단계 크고 진한 청록이라 이름표와 함께 눈에 띈다
 *  - 클러스터: 흰 테두리를 두른 청록 원에 흰 숫자. 묶인 어린이집이 많을수록 크다
 * 카카오 핀 그림(MarkerImage)은 CSS 변수를 읽지 못하는 이미지라 색은 app/globals.css의 청록 팔레트 값을 그대로 적었다.
 */

/** app/globals.css의 --seed-color-palette-carrot-600 / 800 (청록). 흰 글자와 대비 6.4:1 / 11.4:1 */
export const PIN_COLOR = "#0b6b5d";
export const PIN_SELECTED_COLOR = "#064238";

export type PinSize = { width: number; height: number };

export const PIN_SIZE: PinSize = { width: 32, height: 42 };
export const PIN_SELECTED_SIZE: PinSize = { width: 40, height: 52 };

/** 핀 안에 쓸 건수. 1건이면 쓰지 않고, 10건부터는 "9+" */
export function pinCountText(count: number): string | null {
  if (count <= 1) return null;
  return count >= 10 ? "9+" : String(count);
}

/** 물방울 핀 SVG. 그림 좌표는 32×42 기준이고 width·height로 늘인다. 핀 끝(아래 가운데)이 위치를 가리킨다 */
export function pinSvg(count: number, selected = false): string {
  const { width, height } = selected ? PIN_SELECTED_SIZE : PIN_SIZE;
  const color = selected ? PIN_SELECTED_COLOR : PIN_COLOR;
  const text = pinCountText(count);
  const inner = text
    ? `<circle cx="16" cy="16" r="10" fill="#fff"/><text x="16" y="20.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard',sans-serif" font-size="${text.length > 1 ? 11 : 13}" font-weight="700" fill="${color}">${text}</text>`
    : `<circle cx="16" cy="16" r="5.5" fill="#fff"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 32 42">` +
    // 아래 그림자 → 테두리(흰색) → 몸통 순서로 겹친다
    `<ellipse cx="16" cy="40.5" rx="5" ry="1.5" fill="rgba(0,0,0,0.18)"/>` +
    `<path d="M16 1C7.7 1 1 7.6 1 15.8c0 10.6 12.2 22.2 14 23.9a1.5 1.5 0 0 0 2 0c1.8-1.7 14-13.3 14-23.9C31 7.6 24.3 1 16 1Z" fill="${color}" stroke="#fff" stroke-width="2"/>` +
    inner +
    `</svg>`
  );
}

/** 카카오 MarkerImage에 넘길 이미지 주소 */
export function pinImageSrc(count: number, selected = false): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(count, selected))}`;
}

/**
 * 클러스터 원의 크기 단계. calculator의 경계값([10, 30])으로 묶인 어린이집 수가 10 미만·30 미만·그 이상일 때
 * 각각 CLUSTER_STYLES의 0·1·2번 모양을 쓴다 (카카오 MarkerClusterer 규칙).
 */
export const CLUSTER_CALCULATOR = [10, 30];

const CLUSTER_SIZES = [40, 48, 56];

/** 카카오 MarkerClusterer의 styles. 숫자를 세로 가운데에 두려고 lineHeight를 원 높이(테두리 제외)에 맞춘다 */
export const CLUSTER_STYLES = CLUSTER_SIZES.map((size) => ({
  width: `${size}px`,
  height: `${size}px`,
  lineHeight: `${size - 6}px`,
  background: PIN_COLOR,
  border: "3px solid #fff",
  borderRadius: "50%",
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  color: "#fff",
  textAlign: "center",
  fontWeight: "700",
  fontSize: size >= 56 ? "17px" : "15px",
  boxSizing: "border-box",
}));
