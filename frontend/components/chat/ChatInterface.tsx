"use client";

/** 主聊天区：线程列表、useChat 消息流、模式切换（chat/research）、Composer、研究画布。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2, MessageSquare, Sparkles } from "lucide-react";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ResearchProgress } from "./ResearchProgress";
import { ResearchCanvas } from "./ResearchCanvas";
import { ChatKnowledgeGraph } from "./ChatKnowledgeGraph";
import { ThreadList } from "@/components/chat/ThreadList";
import {
  api,
  getApiBase,
  getToken,
  type Citation,
  type SessionFileItem,
  type ThreadWithMessages,
  type Thread,
} from "@/lib/api";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  getArtifactsFromMessages,
  getMessageCitations,
  getResearchStepsFromMessages,
  toUIMessages,
  type ArtifactPart,
  type RedShipUIMessage,
  type ResearchStep,
} from "@/lib/chat-types";

interface ChatInterfaceProps {
  initialThreadId?: string | null;
}

function chatApiUrl(): string {
  const base = getApiBase().replace(/\/$/, "");
  return base ? `${base}/api/chat` : "/api/chat";
}

export function ChatInterface({ initialThreadId }: ChatInterfaceProps) {
  const { user } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"chat" | "research">("chat");
  const [threadMeta, setThreadMeta] = useState<ThreadWithMessages | null>(null);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId || null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [liveResearchSteps, setLiveResearchSteps] = useState<ResearchStep[]>([]);
  const [sessionFiles, setSessionFiles] = useState<SessionFileItem[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactPart | null>(null);
  const [liveArtifacts, setLiveArtifacts] = useState<Map<string, ArtifactPart>>(new Map());
  const [egoNames, setEgoNames] = useState<string[]>([]);
  const [egoDocIds, setEgoDocIds] = useState<string[]>([]);
  const [showEgoPanel, setShowEgoPanel] = useState(true);

  const threadIdRef = useRef(threadId);
  const modeRef = useRef(mode);
  threadIdRef.current = threadId;
  modeRef.current = mode;

  const reloadThreads = useCallback(async () => {
    try {
      const list = await api<Thread[]>("/api/threads");
      setThreads(list);
    } catch {
      /* ignore */
    }
  }, []);
  const reloadThreadsRef = useRef(reloadThreads);
  reloadThreadsRef.current = reloadThreads;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<RedShipUIMessage>({
        api: chatApiUrl(),
        headers: () => {
          const token = getToken();
          const h: Record<string, string> = {};
          if (token) h.Authorization = `Bearer ${token}`;
          return h;
        },
        prepareSendMessagesRequest: ({ messages, id, headers }) => ({
          headers,
          body: {
            id: threadIdRef.current || id,
            thread_id: threadIdRef.current,
            mode: modeRef.current,
            messages: messages.slice(-1),
          },
        }),
      }),
    []
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
  } = useChat<RedShipUIMessage>({
    transport,
    onData: (dataPart) => {
      if (dataPart.type === "data-ack") {
        const tid = dataPart.data?.thread_id;
        if (tid && tid !== threadIdRef.current) {
          setThreadId(tid);
          router.replace(`/?thread=${tid}`);
        }
        return;
      }
      if (dataPart.type === "data-stage") {
        const label =
          (typeof dataPart.data?.label === "string" && dataPart.data.label) ||
          (typeof dataPart.data?.name === "string" && dataPart.data.name) ||
          null;
        setStage(label);
        if (dataPart.data?.name === "analysis" || dataPart.data?.rewritten_query) {
          setLiveResearchSteps((prev) => [
            ...prev,
            {
              step: "analysis",
              query: String(dataPart.data?.rewritten_query || ""),
              timestamp: Date.now(),
            },
          ]);
        }
        const entities = dataPart.data?.entities as
          | {
              persons?: unknown[];
              organizations?: unknown[];
              events?: unknown[];
              era?: string;
            }
          | undefined;
        if (entities && typeof entities === "object") {
          const names = [
            ...(Array.isArray(entities.persons) ? entities.persons : []),
            ...(Array.isArray(entities.organizations) ? entities.organizations : []),
            ...(Array.isArray(entities.events) ? entities.events : []),
            ...(entities.era ? [entities.era] : []),
          ]
            .map((x) => String(x || "").trim())
            .filter(Boolean);
          if (names.length) {
            setEgoNames((prev) => Array.from(new Set([...prev, ...names])));
            setShowEgoPanel(true);
          }
        }
        return;
      }
      if (dataPart.type === "data-citations") {
        const items = Array.isArray(dataPart.data?.items) ? dataPart.data.items : [];
        const ids = items
          .map((c: Citation) => String(c?.doc_id || "").trim())
          .filter(Boolean);
        if (ids.length) {
          setEgoDocIds((prev) => Array.from(new Set([...prev, ...ids])));
          setShowEgoPanel(true);
        }
        return;
      }
      if (dataPart.type === "data-research-step" && dataPart.data?.step) {
        setLiveResearchSteps((prev) => [
          ...prev,
          { ...dataPart.data, timestamp: Date.now() },
        ]);
        return;
      }
      if (dataPart.type === "data-artifact" && dataPart.data?.id) {
        const art: ArtifactPart = {
          id: dataPart.data.id,
          title: dataPart.data.title || "可视化",
          language: "html",
          code: dataPart.data.code || "",
          status: dataPart.data.status === "streaming" ? "streaming" : "done",
        };
        setLiveArtifacts((prev) => {
          const next = new Map(prev);
          next.set(art.id, art);
          return next;
        });
        setActiveArtifact(art);
      }
    },
    onFinish: async ({ isAbort, isError, message }) => {
      setStage(null);
      const tid =
        threadIdRef.current ||
        message.metadata?.threadId ||
        undefined;
      if (!tid || isAbort || isError) {
        void reloadThreadsRef.current();
        return;
      }
      try {
        const fresh = await api<ThreadWithMessages>(`/api/threads/${tid}`);
        setThreadMeta(fresh);
        setMessages(toUIMessages(fresh.messages));
        setLiveResearchSteps([]);
        setLiveArtifacts(new Map());
      } catch {
        /* keep streamed messages */
      }
      void reloadThreadsRef.current();
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!user) return;
    reloadThreads();
  }, [user, reloadThreads]);

  useEffect(() => {
    if (!threadId) {
      setThreadMeta(null);
      setSessionFiles([]);
      return;
    }
    let cancelled = false;
    api<ThreadWithMessages>(`/api/threads/${threadId}`)
      .then((t) => {
        if (cancelled) return;
        setThreadMeta(t);
        setMode(t.mode);
        if (status === "ready" || status === "error") {
          setMessages(toUIMessages(t.messages));
          setLiveResearchSteps([]);
          setLiveArtifacts(new Map());
          setStage(null);
          clearError();
        }
      })
      .catch(() => {
        if (!cancelled) setThreadMeta(null);
      });
    api<SessionFileItem[]>(`/api/threads/${threadId}/files`)
      .then((files) => {
        if (!cancelled) setSessionFiles(files);
      })
      .catch(() => {
        if (!cancelled) setSessionFiles([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const researchSteps = useMemo(() => {
    const fromParts = getResearchStepsFromMessages(messages);
    if (liveResearchSteps.length === 0) return fromParts;
    if (isBusy) return liveResearchSteps;
    return fromParts.length > 0 ? fromParts : liveResearchSteps;
  }, [messages, liveResearchSteps, isBusy]);

  const handleSend = useCallback(
    async (query: string) => {
      clearError();
      setStage(null);
      setLiveResearchSteps([]);
      setLiveArtifacts(new Map());
      setEgoNames([]);
      setEgoDocIds([]);
      setShowEgoPanel(true);
      await sendMessage({
        text: query,
        metadata: {
          threadId: threadId ?? undefined,
          mode,
          attachments: sessionFiles.map((f) => ({
            id: f.id,
            filename: f.filename,
            mode: f.mode,
            chunks_count: f.chunks_count,
          })),
        },
      });
    },
    [sendMessage, threadId, mode, clearError, sessionFiles]
  );

  const handleStop = useCallback(() => {
    void stop();
    setStage(null);
  }, [stop]);

  const handleCitationClick = useCallback(
    (citation: Citation, message: RedShipUIMessage) => {
      const msgId = message.id;
      const tid = threadMeta?.id || threadId || message.metadata?.threadId;
      if (!tid || !msgId) return;
      router.push(`/threads/${tid}/messages/${msgId}/citations/${citation.id}`);
    },
    [router, threadMeta, threadId]
  );

  const startNewThread = useCallback(
    (nextMode: "chat" | "research") => {
      void stop();
      setMode(nextMode);
      setThreadId(null);
      setThreadMeta(null);
      setMessages([]);
      setLiveResearchSteps([]);
      setLiveArtifacts(new Map());
      setSessionFiles([]);
      setActiveArtifact(null);
      setStage(null);
      clearError();
      router.replace("/");
    },
    [router, setMessages, stop, clearError]
  );

  const onPickThread = (t: Thread) => {
    void stop();
    setMessages([]);
    setLiveResearchSteps([]);
    setLiveArtifacts(new Map());
    setActiveArtifact(null);
    setStage(null);
    clearError();
    setThreadId(t.id);
    router.replace(`/?thread=${t.id}`);
  };

  const ensureThread = useCallback(async () => {
    if (threadId) return threadId;
    try {
      const t = await api<Thread>("/api/threads", {
        method: "POST",
        json: { title: "新对话", mode },
      });
      setThreadId(t.id);
      setThreadMeta({ ...t, messages: [] });
      setMessages([]);
      setSessionFiles([]);
      router.replace(`/?thread=${t.id}`);
      reloadThreads();
      return t.id;
    } catch {
      return null;
    }
  }, [threadId, mode, router, reloadThreads, setMessages]);

  const handleOpenArtifact = useCallback((art: ArtifactPart) => {
    setActiveArtifact(art);
  }, []);

  // Prefer live streaming artifact for canvas display
  const canvasArtifact = useMemo(() => {
    if (activeArtifact) {
      const live = liveArtifacts.get(activeArtifact.id);
      return live || activeArtifact;
    }
    const fromLive = Array.from(liveArtifacts.values()).at(-1);
    if (fromLive) return fromLive;
    const fromMsgs = getArtifactsFromMessages(messages);
    return fromMsgs.at(-1) || null;
  }, [activeArtifact, liveArtifacts, messages]);

  const showCanvas = Boolean(canvasArtifact && activeArtifact);

  // 从最新助手消息补齐引用文档（流式结束后或历史会话）
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const cites = getMessageCitations(lastAssistant);
    const ids = cites.map((c) => String(c.doc_id || "").trim()).filter(Boolean);
    if (ids.length) {
      setEgoDocIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  }, [messages]);

  const showEgo = showEgoPanel && !showCanvas && mode === "chat";

  const activeTitle =
    threadMeta?.title || (mode === "research" ? "新的深度研究" : "新的快速问答");
  const visibleMessageCount = messages.length;

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
                    {sessionFiles.length > 0 ? ` · ${sessionFiles.length} 个附件` : ""}
                    {stage ? ` · ${stage}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    {mode === "research" ? (
                      <Sparkles className="h-3.5 w-3.5" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" />
                    )}
                    {mode === "research" ? "深度研究" : "快速问答"}
                  </span>
                  {isBusy ? (
                    <span className="chip">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      生成中
                    </span>
                  ) : null}
                </div>
              </div>
            </header>

            <ResearchProgress
              steps={researchSteps}
              loading={isBusy}
              stage={stage}
              compact
              title={mode === "research" ? "深度研究进度" : "处理进度"}
            />

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 scroll-pretty">
              {messages.length === 0 && !isBusy ? (
                <EmptyState mode={mode} hasFiles={sessionFiles.length > 0} />
              ) : (
                <MessageList
                  messages={messages}
                  status={status}
                  error={error}
                  mode={mode}
                  threadId={threadMeta?.id || threadId}
                  onCitationClick={handleCitationClick}
                  onDismissError={clearError}
                  onOpenArtifact={handleOpenArtifact}
                />
              )}
            </div>

            <div className="mt-4">
              <Composer
                mode={mode}
                onModeChange={setMode}
                threadId={threadMeta?.id || threadId}
                loading={isBusy}
                onSend={handleSend}
                onStop={handleStop}
                onEnsureThread={ensureThread}
                sessionFiles={sessionFiles}
                onFilesChange={setSessionFiles}
              />
            </div>
          </div>
        </section>

        {showCanvas ? (
          <>
            <ResearchCanvas
              artifact={canvasArtifact}
              onClose={() => setActiveArtifact(null)}
              variant="panel"
            />
            <ResearchCanvas
              artifact={canvasArtifact}
              onClose={() => setActiveArtifact(null)}
              variant="drawer"
            />
          </>
        ) : showEgo ? (
          <>
            <ChatKnowledgeGraph
              names={egoNames}
              docIds={egoDocIds}
              onClose={() => setShowEgoPanel(false)}
              variant="panel"
            />
            <ChatKnowledgeGraph
              names={egoNames}
              docIds={egoDocIds}
              onClose={() => setShowEgoPanel(false)}
              variant="drawer"
            />
          </>
        ) : null}
      </div>
    </main>
  );
}

function EmptyState({ mode, hasFiles }: { mode: "chat" | "research"; hasFiles: boolean }) {
  const samples =
    mode === "chat"
      ? hasFiles
        ? [
            "请总结已上传文档的核心观点与证据",
            "基于附件撰写一份会议纪要（Markdown）",
            "对照附件内容，梳理关键时间线与人物关系",
          ]
        : [
            "中共一大召开的历史背景与主要决议有哪些？",
            "请概述长征过程中遵义会议的历史地位。",
            "如何理解新民主主义革命总路线的核心要义？",
          ]
      : hasFiles
        ? [
            "深度研究：结合会话附件，梳理史料争议与可靠结论",
            "深度研究：基于上传文献撰写可引用的学术短报告",
            "深度研究：抽取附件中的时间线并可视化关键节点",
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
        {hasFiles
          ? "已加载会话文档。可基于附件进行分析问答，或要求撰写报告 / 纪要 / 摘要；完成后可导出 Markdown、Word 或 PDF。"
          : "南开大学党史 RAG 智能体。以权威文献为基础提供可溯源回答。可上传会话附件进行分析，或选择「快速问答」/「深度研究」提问。"}
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
