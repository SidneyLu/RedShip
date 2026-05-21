"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ResearchProgress } from "./ResearchProgress";
import { ThreadList } from "@/components/chat/ThreadList";
import { useChatStream } from "./useChatStream";
import { api, type Citation, type Message, type ThreadWithMessages, type Thread } from "@/lib/api";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/providers/ToastProvider";

interface ChatInterfaceProps {
  initialThreadId?: string | null;
}

export function ChatInterface({ initialThreadId }: ChatInterfaceProps) {
  const { user } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const { show } = useToast();
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

  const onNewThread = () => {
    setThreadId(null);
    setThread(null);
    setStagedQuery(null);
    router.replace("/");
  };

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

  return (
    <div className="grid h-full min-h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_320px]">
      <ThreadList
        threads={threads}
        activeId={threadId}
        onPick={onPickThread}
        onNew={onNewThread}
        onChange={reloadThreads}
      />

      <section className="flex h-full min-h-[70vh] flex-col gap-4">
        <div className="panel flex-1 overflow-y-auto px-4 py-2 scroll-pretty">
          {messages.length === 0 && !stagedQuery && !state.loading ? (
            <EmptyState mode={mode} />
          ) : (
            <MessageList
              messages={messages}
              streaming={
                state.loading || state.tokens
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
        <Composer
          mode={mode}
          onModeChange={setMode}
          threadId={thread?.id || state.threadId}
          loading={state.loading}
          onSend={handleSend}
          onCancel={cancel}
          onEnsureThread={ensureThread}
        />
      </section>

      <aside className="hidden lg:block">
        {mode === "research" || state.researchSteps.length > 0 ? (
          <ResearchProgress
            steps={state.researchSteps}
            loading={state.loading}
            stage={state.stage}
          />
        ) : (
          <KnowledgeAside />
        )}
      </aside>
    </div>
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

function KnowledgeAside() {
  return (
    <div className="panel p-4">
      <div className="text-sm font-semibold text-crimson-800">知识库速览</div>
      <p className="mt-2 text-xs leading-6 text-muted">
        日新册基于 <code className="rounded bg-canvas px-1 text-crimson-700">bibliography/</code>{" "}
        目录下的党史文献增量构建，支持 PDF / Markdown / DOCX 自动入库。
      </p>
      <p className="mt-2 text-xs leading-6 text-muted">
        检索流程：Milvus 混合检索（ANN + BM25）→ qwen3-rerank 精排 → 父块回溯 → qwen3-plus 流式生成。
      </p>
      <a className="btn-outline mt-4 w-full justify-center" href="/knowledge">
        进入知识库管理
      </a>
    </div>
  );
}
