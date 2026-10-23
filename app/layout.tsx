import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "보육공고 — 어린이집 신입·담임교사 공고 모아보기",
  description:
    "서울시 육아종합지원센터와 직장어린이집(한솔·푸르니·삼성·모아맘) 채용 공고 중 서울의 신입·담임교사 공고만 한곳에 모아 보여줘요.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // SEED 테마: 밝은 테마로 고정한다 (어두운 테마는 MVP 범위가 아니다)
    <html lang="ko" className="h-full antialiased" data-seed data-seed-color-mode="light-only">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
