"use client";

/** 消息气泡列表；按 UIMessage parts 渲染 text / reasoning / citations / attachments。 */

import { useEffect, useRef, useState } from "react";
import type { ChatStatus } from "ai";
import { Bot, User as UserIcon, BookOpen, ChevronDown, Sparkles, X, FileText, LayoutDashboard } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageActions } from "./MessageActions";
import { CitationPreviewProvider } from "@/components/citations/CitationPreviewProvider";
import { CitationChip } from "@/components/citations/CitationChip";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/api";
import {
  getMessageAttachments,
  getMessageArtifacts,
  getMessageCitations,
  getMessageReasoning,
  getMessageText,
  type ArtifactPart,
  type RedShipUIMessage,
} from "@/lib/chat-types";

interface Props {
  messages: RedShipUIMessage[];
  status: ChatStatus;
  error?: Error | undefined;
  /** Fallback when message.metadata.mode is missing (e.g. mid-stream assistant). */
  mode?: "chat" | "research";
  threadId?: string | null;
  onCitationClick?: (citation: Citation, message: RedShipUIMessage) => void;
  onDismissError?: () => void;
  onOpenArtifact?: (artifact: ArtifactPart) => void;
}

export function MessageList({
  messages,
  status,
  error,
  mode = "chat",
  threadId,
  onCitationClick,
  onDismissError,
  onOpenArtifact,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const isStreaming = status === "streaming" || status === "submitted";
  const last = messages[messages.length - 1];
  const lastText = last ? getMessageText(last) : "";
  const showTrailingTyping =
    isStreaming && (!last || last.role === "user" || (last.role === "assistant" && !lastText));
  const fallbackMode: "chat" | "research" = last?.metadata?.mode || mode;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, isStreaming, error?.message, lastText]);

  return (
    <CitationPreviewProvider>
      <div className="space-y-3.5 px-0.5 py-2">
        {messages.map((m, idx) => {
          const isLast = idx === messages.length - 1;
          const showInlineTyping =
            isLast &&
            m.role === "assistant" &&
            isStreaming &&
            !getMessageText(m) &&
            !showTrailingTyping;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              modeFallback={mode}
              typing={Boolean(showInlineTyping)}
              threadId={threadId}
              onCitationClick={(c) => onCitationClick?.(c, m)}
              onOpenArtifact={onOpenArtifact}
            />
          );
        })}
        {showTrailingTyping ? <TypingBubble mode={fallbackMode} /> : null}
        {error ? (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-2xl border border-crimson-200 bg-crimson-50 px-4 py-3 text-sm text-crimson-800"
          >
            <span>{error.message || "生成失败，请重试。"}</span>
            {onDismissError ? (
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 rounded-lg p-1 text-crimson-700 hover:bg-crimson-100"
                aria-label="关闭错误"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
    </CitationPreviewProvider>
  );
}

function TypingBubble({ mode }: { mode: "chat" | "research" }) {
  return (
    <article className="flex w-full justify-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-crimson-100 text-crimson-700">
        {mode === "research" ? <Sparkles className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className="max-w-[92%] rounded-xl border border-border bg-card px-3 py-2 shadow-soft">
        <TypingDots />
      </div>
    </article>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 py-1" aria-label="正在生成">
      <span className="pulse-dot" />
      <span className="pulse-dot delay-1" />
      <span className="pulse-dot delay-2" />
    </span>
  );
}

function AttachmentStrip({
  attachments,
  inverted,
}: {
  attachments: ReturnType<typeof getMessageAttachments>;
  inverted?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <div className={cn("mb-2 flex flex-wrap gap-1.5", inverted && "opacity-95")}>
      {attachments.map((a, i) => (
        <span
          key={a.id || `${a.filename}-${i}`}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
            inverted
              ? "bg-white/15 text-white"
              : "border border-border bg-canvas/60 text-muted"
          )}
          title={
            a.mode === "fulltext" || a.mode === "files_api"
              ? "全文注入"
              : a.mode === "session_rag"
                ? "会话 RAG"
                : undefined
          }
        >
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{a.filename}</span>
        </span>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  modeFallback = "chat",
  typing,
  threadId,
  onCitationClick,
  onOpenArtifact,
}: {
  message: RedShipUIMessage;
  modeFallback?: "chat" | "research";
  typing?: boolean;
  threadId?: string | null;
  onCitationClick?: (c: Citation) => void;
  onOpenArtifact?: (artifact: ArtifactPart) => void;
}) {
  const isUser = message.role === "user";
  const isResearch = (message.metadata?.mode || modeFallback) === "research" && !isUser;
  const text = getMessageText(message);
  const reasoning = getMessageReasoning(message);
  const citations = getMessageCitations(message);
  const attachments = getMessageAttachments(message);
  const artifacts = getMessageArtifacts(message);
  const tid = threadId || message.metadata?.threadId;

  return (
    <article className={cn("flex w-full gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-crimson-100 text-crimson-700">
          {isResearch ? <Sparkles className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </div>
      )}
      <div
        className={cn(
          "rounded-xl border px-3 py-2 shadow-soft transition",
          isUser
            ? "max-w-[78%] border-crimson-200 bg-crimson-600 text-white"
            : isResearch
              ? "max-w-[min(100%,52rem)] flex-1 border-crimson-100 bg-card"
              : "max-w-[92%] border-border bg-card"
        )}
      >
        {!isUser && isResearch && (
          <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-crimson-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-crimson-700">
            <BookOpen className="h-3 w-3" />
            深度研究报告
          </div>
        )}
        <AttachmentStrip attachments={attachments} inverted={isUser} />
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-6">{text}</p>
        ) : (
          <div className="space-y-2.5">
            {reasoning ? <ReasoningPanel text={reasoning} /> : null}
            {typing && !text ? (
              <TypingDots />
            ) : text ? (
              <MarkdownMessage
                content={text}
                citations={citations}
                threadId={tid}
                messageId={message.id}
                onCitationClick={onCitationClick}
                onOpenArtifact={onOpenArtifact}
              />
            ) : null}
            {artifacts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {artifacts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpenArtifact?.(a)}
                    className="inline-flex items-center gap-1 rounded-lg border border-crimson-200 bg-crimson-50 px-2 py-1 text-[11px] text-crimson-800 hover:bg-crimson-100"
                  >
                    <LayoutDashboard className="h-3 w-3" />
                    打开画布：{a.title}
                  </button>
                ))}
              </div>
            ) : null}
            {citations.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                {citations.map((c) => (
                  <CitationChip
                    key={c.id}
                    label={`(${c.ordinal})`}
                    citation={c}
                    onClick={onCitationClick}
                    variant="report-inline"
                  />
                ))}
              </div>
            ) : null}
            {tid && text ? (
              <MessageActions
                threadId={tid}
                messageId={message.id}
                text={text}
                emphasizeExport={isResearch}
              />
            ) : null}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-crimson-600 text-white">
          <UserIcon className="h-3.5 w-3.5" />
        </div>
      )}
    </article>
  );
}

function ReasoningPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/80 bg-canvas/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-muted hover:text-ink"
      >
        <span>思考过程</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="whitespace-pre-wrap border-t border-border/60 px-3 py-2 text-xs leading-6 text-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}
