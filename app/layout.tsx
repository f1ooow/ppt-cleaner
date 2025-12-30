import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PPT素材清洗工具',
  description: 'AI 自动去除文字和模板装饰，提取纯净素材',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
