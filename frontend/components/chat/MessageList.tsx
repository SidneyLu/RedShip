"use client";

import { useEffect, useRef } from "react";
import { Bot, User as UserIcon, BookOpen, Sparkles } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage";
import { CitationPreviewProvider } from "@/components/citations/CitationPreviewProvider";
import { cn } from "@/lib/utils";
import type { Citation, Message } from "@/lib/api";

interface StreamingMessage {
  id?: string;
  tokens: string;
  citations: Citation[];
  mode: "chat" | "research";
}

interface Props {
  messages: Message[];
  streaming?: StreamingMessage | null;
  onCitationClick?: (citation: Citation, message: Message | StreamingMessage) => void;
  stagedQuery?: string | null;
}

export function MessageList({ messages, streaming, onCitationClick, stagedQuery }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, streaming?.tokens.length, stagedQuery]);

  return (
    <CitationPreviewProvider>
      <div className="space-y-6 px-1 py-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onCitationClick={(c) => onCitationClick?.(c, m)}
          />
        ))}
        {stagedQuery && (
          <MessageBubble
            message={{
              id: "__staged_user",
              thread_id: "",
              role: "user",
              mode: streaming?.mode || "chat",
              content_markdown: stagedQuery,
              citations: null,
              created_at: new Date().toISOString(),
            }}
          />
        )}
        {streaming && (streaming.tokens.length > 0 || streaming.citations.length > 0) && (
          <MessageBubble
            message={{
              id: streaming.id || "__streaming",
              thread_id: "",
              role: "assistant",
              mode: streaming.mode,
              content_markdown: streaming.tokens || "（正在生成…）",
              citations: streaming.citations,
              created_at: new Date().toISOString(),
            }}
            onCitationClick={(c) => onCitationClick?.(c, streaming)}
          />
        )}
        <div ref={endRef} />
      </div>
    </CitationPreviewProvider>
  );
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: Message;
  onCitationClick?: (c: Citation) => void;
}) {
  const isUser = message.role === "user";
  const isResearch = message.mode === "research" && !isUser;
  return (
    <article
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crimson-100 text-crimson-700">
          {isResearch ? <Sparkles className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      )}
      <div
        className={cn(
          "max-w-[78%] rounded-2xl border px-4 py-3 shadow-soft transition",
          isUser
            ? "border-crimson-200 bg-crimson-600 text-white"
            : isResearch
            ? "border-crimson-100 bg-card"
            : "border-border bg-card"
        )}
      >
        {!isUser && isResearch && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-crimson-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-crimson-700">
            <BookOpen className="h-3 w-3" />
            深度研究报告
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap leading-7">{message.content_markdown}</p>
        ) : (
          <MarkdownMessage
            content={message.content_markdown}
            citations={message.citations}
            onCitationClick={onCitationClick}
          />
        )}
      </div>
      {isUser && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crimson-600 text-white">
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </article>
  );
}
