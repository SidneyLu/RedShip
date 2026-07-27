"use client";

/** 主聊天区：线程列表、useChat 消息流、模式切换（chat/research）、Composer、研究画布。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus } from "ai";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
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
  const statusRef = useRef<ChatStatus>("ready");
  /** Thread that owns the in-flight useChat stream (may differ from the viewed thread). */
  const streamOwnerThreadIdRef = useRef<string | null>(null);
  /**
   * When non-null, the UI is detached from useChat.messages so a background stream
   * can keep updating that array without clobbering the thread the user is viewing.
   */
  const [viewMessages, setViewMessages] = useState<RedShipUIMessage[] | null>(null);
  const attachedToStreamRef = useRef(true);
  threadIdRef.current = threadId;
  modeRef.current = mode;
  attachedToStreamRef.current = viewMessages === null;

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
        prepareSendMessagesRequest: ({ messages, headers }) => {
          // Only send a real thread UUID. useChat's client `id` is a nanoid and
          // must not be used as threads.id (Postgres UUID) — that causes 500 / failed to fetch.
          const tid = threadIdRef.current;
          return {
            headers,
            body: {
              ...(tid ? { id: tid, thread_id: tid } : {}),
              mode: modeRef.current,
              messages: messages.slice(-1),
            },
          };
        },
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
        if (tid) {
          streamOwnerThreadIdRef.current = tid;
          // Only navigate if the user is still attached to this stream.
          if (attachedToStreamRef.current && tid !== threadIdRef.current) {
            setThreadId(tid);
            router.replace(`/?thread=${tid}`);
          } else if (!attachedToStreamRef.current) {
            void reloadThreadsRef.current();
          }
        }
        return;
      }
      // Live chrome (stage / ego / artifacts) only when viewing the streaming thread.
      if (!attachedToStreamRef.current) return;
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
      const streamTid =
        (typeof message.metadata?.threadId === "string" && message.metadata.threadId) ||
        streamOwnerThreadIdRef.current ||
        undefined;
      const tid = streamTid || threadIdRef.current || undefined;
      streamOwnerThreadIdRef.current = null;

      const adoptViewedThreadIntoChat = async () => {
        const currentTid = threadIdRef.current;
        try {
          if (currentTid) {
            const fresh = await api<ThreadWithMessages>(`/api/threads/${currentTid}`);
            if (threadIdRef.current !== currentTid) return;
            setThreadMeta(fresh);
            setMessages(toUIMessages(fresh.messages));
          } else {
            setMessages([]);
          }
          setViewMessages(null);
          setLiveResearchSteps([]);
          setLiveArtifacts(new Map());
        } catch {
          /* keep detached view */
        }
      };

      // Abort/error: keep local partials if still attached (Stop button).
      // Backend persists on disconnect; switching back reloads from DB.
      if (!tid || isAbort || isError) {
        void reloadThreadsRef.current();
        if (!attachedToStreamRef.current) {
          await adoptViewedThreadIntoChat();
        }
        return;
      }
      // Stream finished while user views another thread: DB already has the full
      // message; adopt the currently viewed thread into useChat without overwrite race.
      if (threadIdRef.current !== tid) {
        void reloadThreadsRef.current();
        await adoptViewedThreadIntoChat();
        return;
      }
      try {
        const fresh = await api<ThreadWithMessages>(`/api/threads/${tid}`);
        setThreadMeta(fresh);
        setMessages(toUIMessages(fresh.messages));
        setViewMessages(null);
        setLiveResearchSteps([]);
        setLiveArtifacts(new Map());
      } catch {
        /* keep streamed messages */
      }
      void reloadThreadsRef.current();
    },
  });

  const streamBusy = status === "submitted" || status === "streaming";
  /** UI busy only when this view is attached to the in-flight stream. */
  const isBusy = streamBusy && viewMessages === null;
  const backgroundBusy = streamBusy && viewMessages !== null;
  const displayMessages = viewMessages ?? messages;
  statusRef.current = status;

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
    const busy =
      statusRef.current === "submitted" || statusRef.current === "streaming";
    const owner = streamOwnerThreadIdRef.current;
    const reattachToStream = busy && owner === threadId;

    api<ThreadWithMessages>(`/api/threads/${threadId}`)
      .then((t) => {
        if (cancelled) return;
        setThreadMeta(t);
        setMode(t.mode);
        if (reattachToStream) {
          // Show live useChat.messages for the thread still streaming.
          setViewMessages(null);
          clearError();
          return;
        }
        if (busy && owner !== threadId) {
          // Background stream owns useChat.messages — load this thread into the overlay.
          // owner may be null before data-ack.
          setViewMessages(toUIMessages(t.messages));
          setLiveResearchSteps([]);
          setLiveArtifacts(new Map());
          setStage(null);
          setActiveArtifact(null);
          clearError();
          return;
        }
        setViewMessages(null);
        setMessages(toUIMessages(t.messages));
        setLiveResearchSteps([]);
        setLiveArtifacts(new Map());
        setStage(null);
        clearError();
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
    const fromParts = getResearchStepsFromMessages(displayMessages);
    if (viewMessages !== null) return fromParts;
    if (liveResearchSteps.length === 0) return fromParts;
    if (isBusy) return liveResearchSteps;
    return fromParts.length > 0 ? fromParts : liveResearchSteps;
  }, [displayMessages, liveResearchSteps, isBusy, viewMessages]);

  const handleSend = useCallback(
    async (query: string) => {
      // useChat is single-instance; refuse sends while any stream is in flight.
      if (statusRef.current === "submitted" || statusRef.current === "streaming") {
        return;
      }
      clearError();
      setStage(null);
      setLiveResearchSteps([]);
      setLiveArtifacts(new Map());
      setEgoNames([]);
      setEgoDocIds([]);
      setShowEgoPanel(true);
      setViewMessages(null);
      streamOwnerThreadIdRef.current = threadId;
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

  /** Explicit Stop only — thread switches must not call this. */
  const handleStop = useCallback(async () => {
    try {
      await stop();
    } catch {
      /* ignore */
    }
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
    async (nextMode: "chat" | "research") => {
      const busy =
        statusRef.current === "submitted" || statusRef.current === "streaming";
      // Detach from in-flight stream; do not abort (useChat is single-instance —
      // sending on the new thread stays blocked until the background stream ends).
      if (busy) {
        setViewMessages([]);
      } else {
        setViewMessages(null);
        setMessages([]);
      }
      setMode(nextMode);
      setThreadId(null);
      setThreadMeta(null);
      setLiveResearchSteps([]);
      setLiveArtifacts(new Map());
      setSessionFiles([]);
      setActiveArtifact(null);
      setStage(null);
      clearError();
      router.replace("/");
    },
    [router, setMessages, clearError]
  );

  const onPickThread = (t: Thread) => {
    if (t.id === threadIdRef.current && viewMessages === null) return;
    const busy =
      statusRef.current === "submitted" || statusRef.current === "streaming";
    const owner = streamOwnerThreadIdRef.current;

    // Re-attach to the thread that still owns the live stream.
    if (busy && owner === t.id) {
      setViewMessages(null);
      setLiveResearchSteps([]);
      setLiveArtifacts(new Map());
      setActiveArtifact(null);
      setStage(null);
      clearError();
      setThreadId(t.id);
      router.replace(`/?thread=${t.id}`);
      return;
    }

    // Leave an in-flight stream running; park useChat.messages and load the target.
    // owner may be null before data-ack for a brand-new thread.
    if (busy && owner !== t.id) {
      setViewMessages([]); // filled by threadId effect from API
      setLiveResearchSteps([]);
      setLiveArtifacts(new Map());
      setActiveArtifact(null);
      setStage(null);
      clearError();
      setThreadId(t.id);
      router.replace(`/?thread=${t.id}`);
      return;
    }

    // Idle switch: clear then let the effect hydrate from API.
    setViewMessages(null);
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
    if (viewMessages !== null) {
      const fromMsgs = getArtifactsFromMessages(displayMessages);
      return activeArtifact || fromMsgs.at(-1) || null;
    }
    if (activeArtifact) {
      const live = liveArtifacts.get(activeArtifact.id);
      return live || activeArtifact;
    }
    const fromLive = Array.from(liveArtifacts.values()).at(-1);
    if (fromLive) return fromLive;
    const fromMsgs = getArtifactsFromMessages(displayMessages);
    return fromMsgs.at(-1) || null;
  }, [activeArtifact, liveArtifacts, displayMessages, viewMessages]);

  const showCanvas = Boolean(canvasArtifact && activeArtifact && viewMessages === null);

  // 从最新助手消息补齐引用文档（流式结束后或历史会话）
  useEffect(() => {
    const lastAssistant = [...displayMessages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const cites = getMessageCitations(lastAssistant);
    const ids = cites.map((c) => String(c.doc_id || "").trim()).filter(Boolean);
    if (ids.length) {
      setEgoDocIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  }, [displayMessages]);

  const showEgo = showEgoPanel && !showCanvas && mode === "chat";
  const isDesktop = useIsLg();

  const panelIds = useMemo(
    () => (showEgo ? ["threads", "chat", "ego"] : ["threads", "chat"]),
    [showEgo]
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: showEgo ? "redship-workspace-ego" : "redship-workspace",
    panelIds,
    storage: typeof window !== "undefined" ? localStorage : undefined,
  });

  const activeTitle =
    threadMeta?.title || (mode === "research" ? "新的深度研究" : "新的快速问答");
  const visibleMessageCount = displayMessages.length;

  const chatMain = (
    <div className="panel flex h-full min-h-0 flex-col p-1.5 md:p-2">
      <header className="flex shrink-0 items-center gap-2 border-b border-crimson-100/80 px-1.5 py-1">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-ink" title={activeTitle}>
          {activeTitle}
        </h2>
        <p className="hidden shrink-0 text-[10px] text-muted sm:block">
          {mode === "research" ? "深度研究" : "快速问答"} · {visibleMessageCount}
          {sessionFiles.length > 0 ? ` · ${sessionFiles.length} 附件` : ""}
          {stage && isBusy ? ` · ${stage}` : ""}
        </p>
        {isBusy || backgroundBusy ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-crimson-50 px-1.5 py-0.5 text-[10px] text-crimson-800">
            <Loader2 className="h-3 w-3 animate-spin" />
            {isBusy ? "生成中" : "后台"}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
            {mode === "research" ? (
              <Sparkles className="h-3 w-3 text-crimson-700" />
            ) : (
              <MessageSquare className="h-3 w-3 text-crimson-700" />
            )}
            {mode === "research" ? "研究" : "问答"}
          </span>
        )}
      </header>

      <ResearchProgress
        steps={researchSteps}
        loading={isBusy}
        stage={isBusy ? stage : null}
        compact
        title={mode === "research" ? "深度研究进度" : "处理进度"}
      />

      {/* Messages scroll under a floating composer; pb clears the bar. */}
      <div className="relative mt-1.5 min-h-0 flex-1">
        <div className="h-full overflow-y-auto scroll-pretty pr-1 pb-[4.75rem] sm:pb-[5.25rem]">
          {displayMessages.length === 0 && !isBusy ? (
            <EmptyState
              mode={mode}
              hasFiles={sessionFiles.length > 0}
              onSelectPrompt={handleSend}
            />
          ) : (
            <MessageList
              messages={displayMessages}
              status={isBusy ? status : "ready"}
              error={isBusy || viewMessages === null ? error : undefined}
              mode={mode}
              threadId={threadMeta?.id || threadId}
              onCitationClick={handleCitationClick}
              onDismissError={clearError}
              onOpenArtifact={handleOpenArtifact}
            />
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-card from-40% via-card/85 to-transparent px-0.5 pb-[max(0.2rem,env(safe-area-inset-bottom))] pt-4">
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <Composer
              mode={mode}
              onModeChange={setMode}
              threadId={threadMeta?.id || threadId}
              loading={isBusy}
              backgroundBusy={backgroundBusy}
              onSend={handleSend}
              onStop={handleStop}
              onEnsureThread={ensureThread}
              sessionFiles={sessionFiles}
              onFilesChange={setSessionFiles}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const threadListProps = {
    threads,
    activeId: threadId,
    onPick: onPickThread,
    onNewChat: () => startNewThread("chat"),
    onNewResearch: () => startNewThread("research"),
    onChange: reloadThreads,
  };

  const sepClass =
    "w-1.5 rounded-full bg-border transition-colors hover:bg-crimson-300 outline-none";

  return (
    <main className="min-h-screen p-2 md:p-3">
      {isDesktop ? (
        <div className="h-[calc(100vh-1rem)]">
          <Group
            id={showEgo ? "redship-workspace-ego" : "redship-workspace"}
            orientation="horizontal"
            className="h-full w-full"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <Panel
              id="threads"
              defaultSize="18%"
              minSize={160}
              maxSize={360}
              className="min-w-0"
            >
              <ThreadList {...threadListProps} fillContainer />
            </Panel>
            <Separator className={sepClass} />
            <Panel
              id="chat"
              defaultSize={showEgo ? "50%" : "78%"}
              minSize={360}
              className="min-w-0"
            >
              {chatMain}
            </Panel>
            {showEgo ? (
              <>
                <Separator className={sepClass} />
                <Panel id="ego" defaultSize="28%" minSize={240} maxSize={480} className="min-w-0">
                  <ChatKnowledgeGraph
                    names={egoNames}
                    docIds={egoDocIds}
                    onClose={() => setShowEgoPanel(false)}
                    variant="panel"
                  />
                </Panel>
              </>
            ) : null}
          </Group>
        </div>
      ) : (
        <div className="flex min-h-[calc(100vh-1rem)] items-start gap-3">
          <ThreadList {...threadListProps} />
          <section className="flex min-h-[calc(100vh-1rem)] min-w-0 flex-1 flex-col">
            {chatMain}
          </section>
          {showEgo ? (
            <ChatKnowledgeGraph
              names={egoNames}
              docIds={egoDocIds}
              onClose={() => setShowEgoPanel(false)}
              variant="drawer"
            />
          ) : null}
        </div>
      )}

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
      ) : null}
    </main>
  );
}

/** Tailwind `lg` = 1024px；仅挂载一套主栏，避免双份 Composer/消息列表。 */
function useIsLg() {
  const [isLg, setIsLg] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLg(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isLg;
}

function EmptyState({
  mode,
  hasFiles,
  onSelectPrompt,
}: {
  mode: "chat" | "research";
  hasFiles: boolean;
  onSelectPrompt: (query: string) => void;
}) {
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
          <button
            key={s}
            type="button"
            onClick={() => onSelectPrompt(s)}
            className="rounded-2xl border border-border bg-card p-3 text-left text-sm shadow-soft transition hover:border-crimson-200 hover:shadow"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
