"use client";

/** 主聊天区：线程列表、消息流、模式切换（chat/research）、Composer 与 SSE 流。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Sparkles } from "lucide-react";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ResearchProgress } from "./ResearchProgress";
import { ThreadList } from "@/components/chat/ThreadList";
import { useChatStream } from "./useChatStream";
import { api, type Citation, type Message, type ThreadWithMessages, type Thread } from "@/lib/api";
import { useAuth } from "@/components/providers/AuthProvider";

interface ChatInterfaceProps {
  initialThreadId?: string | null;
}

export function ChatInterface({ initialThreadId }: ChatInterfaceProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { state, send, cancel } = useChatStream();

  const [mode, setMode] = useState<"chat" | "research">("chat");
  const [thread, setThread] = useState<ThreadWithMessages | null>(null);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId || null);
  const [stagedQuery, setStagedQuery] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);

  const reloadThreads = useCallback(async () => {
    try {
      const list = await api<Thread[]>("/api/threads");
      setThreads(list);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    reloadThreads();
  }, [user, reloadThreads]);

  useEffect(() => {
    if (!threadId) {
      setThread(null);
      return;
    }
    api<ThreadWithMessages>(`/api/threads/${threadId}`)
      .then((t) => {
        setThread(t);
        setMode(t.mode);
      })
      .catch(() => {
        setThread(null);
      });
  }, [threadId]);

  const messages: Message[] = useMemo(() => thread?.messages ?? [], [thread]);

  const handleSend = useCallback(
    async (query: string) => {
      setStagedQuery(query);
      await send({
        threadId,
        query,
        mode,
        onAck: (ev) => {
          if (ev.thread_id && ev.thread_id !== threadId) {
            setThreadId(ev.thread_id);
            router.replace(`/?thread=${ev.thread_id}`);
          }
        },
        onDone: async ({ threadId: tid }) => {
          setStagedQuery(null);
          try {
            const fresh = await api<ThreadWithMessages>(`/api/threads/${tid}`);
            setThread(fresh);
          } catch {}
          reloadThreads();
        },
      });
    },
    [send, threadId, mode, router, reloadThreads]
  );

  const handleCitationClick = useCallback(
    (citation: Citation, message: Message | { id?: string }) => {
      const msgId = (message as Message).id || state.assistantMessageId || "__streaming";
      const tid = thread?.id || state.threadId;
      if (!tid || !msgId) return;
      router.push(`/threads/${tid}/messages/${msgId}/citations/${citation.id}`);
    },
    [router, thread, state.threadId, state.assistantMessageId]
  );

  const startNewThread = useCallback(
    (nextMode: "chat" | "research") => {
      setMode(nextMode);
      setThreadId(null);
      setThread(null);
      setStagedQuery(null);
      router.replace("/");
    },
    [router]
  );

  const onPickThread = (t: Thread) => {
    setThreadId(t.id);
    router.replace(`/?thread=${t.id}`);
  };

  const ensureThread = useCallback(async () => {
    if (threadId) return threadId;
    try {
      const t = await api<Thread>("/api/threads", { method: "POST", json: { title: "新对话", mode } });
      setThreadId(t.id);
      setThread({ ...t, messages: [] });
      router.replace(`/?thread=${t.id}`);
      reloadThreads();
      return t.id;
    } catch {
      return null;
    }
  }, [threadId, mode, router, reloadThreads]);

  const activeTitle = thread?.title || (mode === "research" ? "新的深度研究" : "新的快速问答");
  const visibleMessageCount =
    messages.length + (stagedQuery ? 1 : 0) + (state.loading ? 1 : 0);

  return (
    <main className="min-h-screen p-2 md:p-3">
      <div className="flex min-h-[calc(100vh-1rem)] items-start gap-3">
        <ThreadList
          threads={threads}
          activeId={threadId}
          onPick={onPickThread}
          onNewChat={() => startNewThread("chat")}
          onNewResearch={() => startNewThread("research")}
          onChange={reloadThreads}
        />

        <section className="flex min-h-[calc(100vh-1rem)] min-w-0 flex-1 flex-col">
          <div className="panel flex min-h-[calc(100vh-1rem)] flex-col p-3 md:p-4">
            <header className="rounded-2xl border border-crimson-100 bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700">
                    研究工作台
                  </p>
                  <h2 className="mt-1 truncate text-2xl font-semibold text-ink">
                    {activeTitle}
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {mode === "research" ? "深度研究" : "快速问答"} · {visibleMessageCount} 条消息
                    {state.stage ? ` · ${state.stage}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    {mode === "research" ? <Sparkles className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                    {mode === "research" ? "深度研究" : "快速问答"}
                  </span>
                  {state.loading ? (
                    <span className="chip">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      生成中
                    </span>
                  ) : null}
                </div>
              </div>
            </header>

            <ResearchProgress
              steps={state.researchSteps}
              loading={state.loading && mode === "research"}
              stage={state.stage}
              compact
            />

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 scroll-pretty">
              {messages.length === 0 && !stagedQuery && !state.loading ? (
                <EmptyState mode={mode} />
              ) : (
                <MessageList
                  messages={messages}
                  streaming={
                    state.loading
                      ? {
                          id: state.assistantMessageId || undefined,
                          tokens: state.tokens,
                          citations: state.citations,
                          mode,
                        }
                      : null
                  }
                  stagedQuery={stagedQuery}
                  onCitationClick={handleCitationClick}
                />
              )}
            </div>

            <div className="mt-4">
              <Composer
                mode={mode}
                onModeChange={setMode}
                threadId={thread?.id || state.threadId}
                loading={state.loading}
                onSend={handleSend}
                onCancel={cancel}
                onEnsureThread={ensureThread}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyState({ mode }: { mode: "chat" | "research" }) {
  const samples =
    mode === "chat"
      ? [
          "中共一大召开的历史背景与主要决议有哪些？",
          "请概述长征过程中遵义会议的历史地位。",
          "如何理解新民主主义革命总路线的核心要义？",
        ]
      : [
          "深度研究：南开大学在抗战时期的历史贡献",
          "深度研究：中共党史中的统一战线政策演进",
          "深度研究：1949 年前后中共在城市治理上的经验",
        ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-10 text-center">
      <div className="text-3xl font-semibold text-crimson-800">日新册</div>
      <p className="max-w-xl text-sm leading-7 text-muted">
        南开大学党史 RAG 智能体。以《中共中央文件选集》《党史资料丛刊》《建国以来重要文献选编》等权威文献为基础，
        提供基于证据的中文回答。请选择
        <span className="text-crimson-700">「快速问答」</span>
        或 <span className="text-crimson-700">「深度研究」</span> 模式提问。
      </p>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
        {samples.map((s) => (
          <div
            key={s}
            className="rounded-2xl border border-border bg-card p-3 text-left text-sm shadow-soft transition hover:border-crimson-200 hover:shadow"
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
