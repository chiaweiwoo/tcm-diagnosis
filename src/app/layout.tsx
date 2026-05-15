import type { Metadata } from "next";
import "./globals.css";
// eslint-disable-next-line @next/next/no-page-custom-font
import { Noto_Sans_SC } from "next/font/google";

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  variable: "--font-noto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "中医病案分析工作台",
  description: "医生端中医病案分析与 DeepSeek API 测试",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans" className={notoSansSC.variable}>
      <body>
        {children}
      </body>
    </html>
  );
}
