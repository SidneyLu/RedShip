"use client";

/** 输入框与发送：模式切换、附件上传、会话文档面板。 */

import { KeyboardEvent, useCallback, useRef, useState } from "react";
import { Send, Square, Sparkles, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileAttachment, removeSessionFile } from "./FileAttachment";
import { SessionDocsPanel } from "./SessionDocsPanel";
import type { SessionFileItem } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";

interface Props {
  mode: "chat" | "research";
  onModeChange: (mode: "chat" | "research") => void;
  threadId: string | null;
  /** true when useChat status is submitted | streaming */
  loading: boolean;
  onSend: (query: string) => void;
  onStop: () => void;
  onFilesChange?: (files: SessionFileItem[]) => void;
  onEnsureThread?: () => Promise<string | null>;
  sessionFiles?: SessionFileItem[];
}

export function Composer({
  mode,
  onModeChange,
  threadId,
  loading,
  onSend,
  onStop,
  onFilesChange,
  onEnsureThread,
  sessionFiles = [],
}: Props) {
  const [value, setValue] = useState("");
  const [docsOpen, setDocsOpen] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { show } = useToast();

  const handleFilesChange = useCallback(
    (files: SessionFileItem[]) => {
      onFilesChange?.(files);
      if (files.length > 0) setDocsOpen(true);
    },
    [onFilesChange]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      if (!threadId) return;
      try {
        await removeSessionFile(threadId, id);
        const next = sessionFiles.filter((f) => f.id !== id);
        onFilesChange?.(next);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        show({ title: "删除失败", description: msg, variant: "destructive" });
      }
    },
    [threadId, sessionFiles, onFilesChange, show]
  );

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
    <div className="space-y-3">
      <SessionDocsPanel
        files={sessionFiles}
        open={docsOpen}
        onOpenChange={setDocsOpen}
        onRemove={handleRemove}
      />
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
          <FileAttachment
            threadId={threadId}
            files={sessionFiles}
            onChange={handleFilesChange}
            onEnsureThread={onEnsureThread}
            onOpenPanel={() => setDocsOpen(true)}
          />
        </div>
        <textarea
          ref={ref}
          className="textarea min-h-[110px] resize-none"
          placeholder={
            mode === "chat"
              ? sessionFiles.length > 0
                ? "基于已上传文档提问，或要求撰写报告 / 纪要 / 摘要…"
                : "向「日新册」提问，例如：遵义会议的主要决议有哪些？"
              : sessionFiles.length > 0
                ? "基于会话附件启动深度研究，并生成可导出报告…"
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
              <button type="button" onClick={onStop} className="btn-outline">
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
    </div>
  );
}
