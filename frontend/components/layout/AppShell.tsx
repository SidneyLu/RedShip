"use client";

/** 应用壳：顶栏导航、鉴权门控与主内容区。 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, BookOpen, Shield, MessageSquareText } from "lucide-react";
import { ReactNode } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { LoginPanel } from "./LoginPanel";

interface Props {
  children: ReactNode;
}

export function AppShell({ children }: Props) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        正在加载…
      </div>
    );
  }

  if (!user) {
    return <LoginPanel />;
  }

  const onLogout = () => {
    logout();
    router.replace("/");
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-crimson-800">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-crimson-700 text-sm font-bold text-canvas">
              新
            </span>
            <span className="text-lg font-semibold tracking-wide">日新册</span>
            <span className="ml-2 hidden text-xs text-muted md:inline">
              · 南开大学党史 RAG 智能体
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/" className="btn-ghost">
              <MessageSquareText className="h-4 w-4" />
              对话
            </Link>
            <Link href="/knowledge" className="btn-ghost">
              <BookOpen className="h-4 w-4" />
              知识库
            </Link>
            {user.is_admin && (
              <Link href="/admin" className="btn-ghost">
                <Shield className="h-4 w-4" />
                管理
              </Link>
            )}
            <div className="ml-3 hidden text-right text-xs text-muted md:block">
              <div className="font-medium text-ink">{user.display_name || user.email}</div>
              <div>{user.is_admin ? "管理员" : "研究者"}</div>
            </div>
            <button type="button" onClick={onLogout} className="btn-ghost">
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
