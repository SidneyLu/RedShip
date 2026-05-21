"use client";

/** 输入框与发送：选择模式、附件上传入口。 */

import { KeyboardEvent, useRef, useState } from "react";
import { Send, Square, Sparkles, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileAttachment } from "./FileAttachment";
import type { SessionFileItem } from "@/lib/api";

interface Props {
  mode: "chat" | "research";
  onModeChange: (mode: "chat" | "research") => void;
  threadId: string | null;
  loading: boolean;
  onSend: (query: string) => void;
  onCancel: () => void;
  onFilesChange?: (files: SessionFileItem[]) => void;
  onEnsureThread?: () => Promise<string | null>;
}

export function Composer({ mode, onModeChange, threadId, loading, onSend, onCancel, onFilesChange, onEnsureThread }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setValue("");
    onSend(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="panel-elev space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-border bg-canvas/40 p-1">
          <button
            type="button"
            onClick={() => onModeChange("chat")}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium transition",
              mode === "chat"
                ? "bg-crimson-600 text-white shadow"
                : "text-muted hover:text-crimson-700"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            快速问答
          </button>
          <button
            type="button"
            onClick={() => onModeChange("research")}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium transition",
              mode === "research"
                ? "bg-crimson-600 text-white shadow"
                : "text-muted hover:text-crimson-700"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            深度研究
          </button>
        </div>
        <FileAttachment threadId={threadId} onChange={onFilesChange} onEnsureThread={onEnsureThread} />
      </div>
      <textarea
        ref={ref}
        className="textarea min-h-[110px] resize-none"
        placeholder={
          mode === "chat"
            ? "向「日新册」提问，例如：遵义会议的主要决议有哪些？"
            : "输入需要深度研究的问题，将自动规划、检索、反思并撰写报告..."
        }
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted">
          {mode === "chat"
            ? "回车发送 · Shift+回车换行 · 快速 RAG 模式"
            : "回车发送 · 多轮联网检索 + 反思 + 报告生成"}
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <button type="button" onClick={onCancel} className="btn-outline">
              <Square className="h-4 w-4" />
              终止
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={loading || !value.trim()}
            className="btn-primary"
          >
            <Send className="h-4 w-4" />
            {mode === "research" ? "启动研究" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
