"use client";

/** 首页工作台侧栏：品牌、搜索、线程切换、新建、置顶与删除。 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BookOpen,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PinIcon,
  Search,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, type Thread } from "@/lib/api";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { cn, timeAgo } from "@/lib/utils";

interface Props {
  threads: Thread[];
  activeId: string | null;
  onPick: (t: Thread) => void;
  onNewChat: () => void;
  onNewResearch: () => void;
  onChange: () => void;
}

export function ThreadList({
  threads,
  activeId,
  onPick,
  onNewChat,
  onNewResearch,
  onChange,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { user, logout } = useAuth();
  const { show } = useToast();
  const router = useRouter();

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      `${t.title} ${t.mode}`.toLowerCase().includes(q)
    );
  }, [query, threads]);

  const pinToggle = async (t: Thread) => {
    setBusy(t.id);
    try {
      await api(`/api/threads/${t.id}`, { method: "PATCH", json: { pinned: !t.pinned } });
      onChange();
    } catch (e: any) {
      show({ title: "操作失败", description: String(e.message), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: Thread) => {
    if (!confirm(`确定要删除对话「${t.title}」吗？`)) return;
    setBusy(t.id);
    try {
      await api(`/api/threads/${t.id}`, { method: "DELETE" });
      onChange();
      if (activeId === t.id) onNewChat();
    } catch (e: any) {
      show({ title: "删除失败", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const pick = (t: Thread) => {
    onPick(t);
    setMobileOpen(false);
  };

  const startChat = () => {
    onNewChat();
    setMobileOpen(false);
  };

  const startResearch = () => {
    onNewResearch();
    setMobileOpen(false);
  };

  const signOut = () => {
    logout();
    router.replace("/");
  };

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/20 md:hidden"
          aria-label="关闭会话栏"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "panel fixed inset-y-2 left-2 z-40 flex min-h-0 w-[86vw] max-w-[320px] flex-col transition-[transform,width,padding,opacity] duration-200 md:sticky md:top-2 md:z-10 md:h-[calc(100vh-1rem)] md:max-w-none md:self-start",
          mobileOpen ? "translate-x-0 opacity-100" : "-translate-x-[120%] opacity-0 md:translate-x-0 md:opacity-100",
          collapsed ? "md:w-[72px] md:items-center md:gap-2 md:px-2 md:py-3" : "gap-3 p-3 md:w-[280px]"
        )}
      >
        {collapsed ? (
          <CollapsedRail
            onExpand={() => setCollapsed(false)}
            onNewChat={startChat}
            onNewResearch={startResearch}
          />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <Link
                href="/"
                className="min-w-0 flex-1 rounded-xl bg-gradient-to-br from-crimson-700 to-crimson-500 p-3 text-white shadow-soft"
              >
                <p className="text-xs tracking-[0.2em] text-crimson-100">RedShip Studio</p>
                <h1 className="mt-1 text-base font-bold leading-snug md:text-lg">日新册</h1>
                <p className="mt-1 text-xs text-crimson-100">南开大学党史 RAG 智能体</p>
              </Link>
              <button
                type="button"
                className="btn-outline hidden shrink-0 px-2 py-2 md:inline-flex"
                onClick={() => setCollapsed(true)}
                aria-label="收起线程栏"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-outline shrink-0 px-2 py-2 md:hidden"
                onClick={() => setMobileOpen(false)}
                aria-label="关闭会话栏"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={startChat}>
                <MessageSquarePlus className="h-4 w-4" />
                快速问答
              </button>
              <button type="button" className="btn-outline px-3 py-2 text-xs" onClick={startResearch}>
                <Sparkles className="h-4 w-4" />
                深度研究
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className="input py-2 pl-9 text-xs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索线程"
              />
            </div>

            <div role="region" aria-label="线程列表" className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 scroll-pretty">
              {filteredThreads.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted">
                  {query ? "没有匹配的线程" : "暂无对话，开始你的第一次提问吧。"}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredThreads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={activeId === t.id}
                      busy={busy === t.id}
                      onPick={() => pick(t)}
                      onPin={() => pinToggle(t)}
                      onDelete={() => remove(t)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="truncate px-1 text-xs text-muted">
                <span className="font-medium text-ink">{user?.display_name || user?.email}</span>
                <span className="ml-2">{user?.is_admin ? "管理员" : "研究者"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link className="btn-outline justify-start px-3 py-2 text-xs" href="/knowledge">
                  <BookOpen className="h-4 w-4" />
                  知识库
                </Link>
                {user?.is_admin ? (
                  <Link className="btn-outline justify-start px-3 py-2 text-xs" href="/admin">
                    <Shield className="h-4 w-4" />
                    管理
                  </Link>
                ) : null}
              </div>
              <button type="button" className="btn-ghost w-full justify-start px-3 py-2 text-xs" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                退出
              </button>
            </div>
          </>
        )}
      </aside>

      {!mobileOpen ? (
        <button
          type="button"
          className="btn-outline fixed left-3 top-3 z-20 px-2 py-2 md:hidden"
          onClick={() => {
            setCollapsed(false);
            setMobileOpen(true);
          }}
          aria-label="展开会话栏"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : null}
    </>
  );
}

function CollapsedRail({
  onExpand,
  onNewChat,
  onNewResearch,
}: {
  onExpand: () => void;
  onNewChat: () => void;
  onNewResearch: () => void;
}) {
  return (
    <div className="hidden h-full w-full flex-col items-center gap-3 md:flex">
      <button type="button" className="btn-outline px-2 py-2" onClick={onExpand} aria-label="展开线程栏">
        <PanelLeftOpen className="h-4 w-4" />
      </button>
      <button type="button" className="btn-outline px-2 py-2" onClick={onNewChat} aria-label="新建快速问答">
        <MessageSquarePlus className="h-4 w-4" />
      </button>
      <button type="button" className="btn-outline px-2 py-2" onClick={onNewResearch} aria-label="新建深度研究">
        <Sparkles className="h-4 w-4" />
      </button>
      <div className="h-px w-full bg-border" />
      <p className="text-[11px] font-semibold tracking-[0.18em] text-crimson-700 [writing-mode:vertical-rl]">
        线程
      </p>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  busy,
  onPick,
  onPin,
  onDelete,
}: {
  thread: Thread;
  active: boolean;
  busy: boolean;
  onPick: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-start gap-1 rounded-xl px-2 py-2 text-left transition",
        active ? "bg-crimson-100 text-crimson-900" : "hover:bg-canvas/80"
      )}
    >
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-start gap-2 text-left">
        <span className="mt-0.5 text-crimson-600">
          {thread.mode === "research" ? <Sparkles className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{thread.title}</span>
          <span className="block truncate text-[10px] uppercase tracking-wider text-muted">
            {thread.mode === "research" ? "深度研究" : "快速问答"} · {timeAgo(thread.last_message_at || thread.created_at)}
          </span>
        </span>
      </button>
      <div className="invisible flex shrink-0 items-center gap-0.5 group-hover:visible group-focus-within:visible">
        <button
          type="button"
          onClick={onPin}
          disabled={busy}
          className={cn("rounded-full p-1 hover:bg-card", thread.pinned ? "text-crimson-700" : "text-muted")}
          title={thread.pinned ? "取消置顶" : "置顶对话"}
        >
          <PinIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-full p-1 text-muted hover:bg-card hover:text-crimson-700"
          title="删除对话"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
