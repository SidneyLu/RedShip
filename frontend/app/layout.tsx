/** 根布局：全局样式、AuthProvider、ToastProvider */

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";

export const metadata: Metadata = {
  title: "日新册 · 南开大学党史 RAG 智能体",
  description:
    "面向党史研究的双模式 RAG 智能体——快速问答与深度研究融合，以权威文献为基底，提供严谨可溯源的中文回答。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#9A3326",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
