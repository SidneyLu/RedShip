import './globals.css';
import type { Metadata } from 'next';
import { ViewTransitionGuard } from '@/components/ViewTransitionGuard';

export const metadata: Metadata = {
  title: '日新册-南开大学中国共产党党史研究智能体',
  description: '多模态RAG、深度研究、文档检索分析与可视化工作台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='zh-CN'>
      <body>
        <ViewTransitionGuard />
        {children}
      </body>
    </html>
  );
}
