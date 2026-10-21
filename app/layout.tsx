import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "보육공고 — 어린이집 신입·담임교사 공고 모아보기",
  description:
    "고용24, 사람인, 육아종합지원센터, 직장어린이집 공고 중 신입·담임교사 공고만 한곳에 모아 최신순으로 보여줘요.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf8f4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
