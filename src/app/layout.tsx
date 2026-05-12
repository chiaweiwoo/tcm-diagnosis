import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

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
    <html lang="zh-Hans">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
