"use client";

/** 输入框与发送：模式切换、附件上传、会话文档面板；闲置时单行折叠。 */

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, Sparkles, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileAttachment, removeSessionFile, retrySessionFile } from "./FileAttachment";
import { SessionDocsPanel } from "./SessionDocsPanel";
import { SessionFilePreview } from "./SessionFilePreview";
import type { SessionFileItem } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";

interface Props {
  mode: "chat" | "research";
  onModeChange: (mode: "chat" | "research") => void;
  threadId: string | null;
  /** true when this view owns an in-flight stream (show Stop) */
  loading: boolean;
  /** true when another thread is still streaming (block send, no Stop here) */
  backgroundBusy?: boolean;
  onSend: (query: string) => void;
  onStop: () => void;
  onFilesChange?: (files: SessionFileItem[]) => void;
  onEnsureThread?: () => Promise<string | null>;
  sessionFiles?: SessionFileItem[];
}

const TEXTAREA_MAX_PX = 120;
const TEXTAREA_COLLAPSED_PX = 34;

export function Composer({
  mode,
  onModeChange,
  threadId,
  loading,
  backgroundBusy = false,
  onSend,
  onStop,
  onFilesChange,
  onEnsureThread,
  sessionFiles = [],
}: Props) {
  const [value, setValue] = useState("");
  const [docsOpen, setDocsOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [previewFile, setPreviewFile] = useState<SessionFileItem | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { show } = useToast();
  const sendBlocked = loading || backgroundBusy;
  const expanded = focused || value.trim().length > 0;

  const resizeTextarea = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (!expanded) {
      el.style.height = `${TEXTAREA_COLLAPSED_PX}px`;
      return;
    }
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), TEXTAREA_MAX_PX)}px`;
  }, [expanded]);

  useEffect(() => {
    resizeTextarea();
  }, [expanded, resizeTextarea]);

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
        setPreviewFile((cur) => (cur?.id === id ? null : cur));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        show({ title: "删除失败", description: msg, variant: "destructive" });
      }
    },
    [threadId, sessionFiles, onFilesChange, show]
  );

  const handleRetry = useCallback(
    async (id: string) => {
      if (!threadId) return;
      try {
        const updated = await retrySessionFile(threadId, id);
        const next = sessionFiles.map((f) => (f.id === id ? updated : f));
        onFilesChange?.(next);
        show({ title: "已重新开始解析", description: updated.filename, variant: "success" });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        show({ title: "重试失败", description: msg, variant: "destructive" });
      }
    },
    [threadId, sessionFiles, onFilesChange, show]
  );

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || sendBlocked) return;
    setValue("");
    setFocused(false);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.style.height = `${TEXTAREA_COLLAPSED_PX}px`;
        ref.current.blur();
      }
    });
    onSend(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (!value.trim()) {
        setFocused(false);
        ref.current?.blur();
      }
    }
  };

  const modeToggle = (
    <div className="inline-flex shrink-0 rounded-md border border-border bg-canvas/40 p-0.5">
      <button
        type="button"
        onClick={() => onModeChange("chat")}
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition",
          mode === "chat" ? "bg-crimson-600 text-white shadow" : "text-muted hover:text-crimson-700"
        )}
        title="快速问答"
      >
        <MessageSquare className="h-3 w-3" />
        <span className={cn(!expanded && "sr-only sm:not-sr-only")}>问答</span>
      </button>
      <button
        type="button"
        onClick={() => onModeChange("research")}
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition",
          mode === "research" ? "bg-crimson-600 text-white shadow" : "text-muted hover:text-crimson-700"
        )}
        title="深度研究"
      >
        <Sparkles className="h-3 w-3" />
        <span className={cn(!expanded && "sr-only sm:not-sr-only")}>研究</span>
      </button>
    </div>
  );

  const actionButtons = (
    <div className="flex shrink-0 items-center gap-1">
      {loading ? (
        <button type="button" onClick={onStop} className="btn-outline px-2 py-1 text-[10px]">
          <Square className="h-3 w-3" />
          终止
        </button>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={sendBlocked || !value.trim()}
        className="btn-primary px-2 py-1 text-[10px]"
      >
        <Send className="h-3 w-3" />
        {mode === "research" ? "研究" : "发送"}
      </button>
    </div>
  );

  return (
    <div className="space-y-1">
      <SessionDocsPanel
        files={sessionFiles}
        open={docsOpen}
        onOpenChange={setDocsOpen}
        onRemove={handleRemove}
        onRetry={handleRetry}
        onPreview={(f) => setPreviewFile(f)}
      />
      {threadId && previewFile ? (
        <SessionFilePreview
          threadId={threadId}
          file={previewFile}
          open={Boolean(previewFile)}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}
      <div
        className={cn(
          "panel-elev shadow-lg ring-1 ring-crimson-100/60 transition-all",
          expanded ? "space-y-1.5 p-2" : "flex items-center gap-1.5 p-1.5"
        )}
      >
        {expanded ? (
          <div className="flex flex-wrap items-center justify-between gap-1">
            {modeToggle}
            <FileAttachment
              threadId={threadId}
              files={sessionFiles}
              onChange={handleFilesChange}
              onEnsureThread={onEnsureThread}
              onOpenPanel={() => setDocsOpen(true)}
            />
          </div>
        ) : (
          modeToggle
        )}

        <textarea
          ref={ref}
          rows={1}
          className={cn(
            "textarea resize-none text-sm leading-5 transition-[min-height,height,padding]",
            expanded
              ? "min-h-[52px] max-h-[120px] w-full rounded-lg px-2.5 py-2"
              : "h-[34px] min-h-[34px] max-h-[34px] flex-1 overflow-hidden rounded-md px-2 py-1.5"
          )}
          placeholder={
            expanded
              ? mode === "chat"
                ? sessionFiles.length > 0
                  ? "基于已上传文档提问，或要求撰写报告 / 纪要 / 摘要…"
                  : "向「日新册」提问…"
                : sessionFiles.length > 0
                  ? "基于会话附件启动深度研究…"
                  : "输入深度研究问题…"
              : mode === "chat"
                ? "提问…"
                : "输入研究问题…"
          }
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            requestAnimationFrame(resizeTextarea);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay so send/mode clicks still register before collapse.
            window.setTimeout(() => {
              if (document.activeElement === ref.current) return;
              if (!ref.current?.value.trim()) setFocused(false);
            }, 120);
          }}
          onKeyDown={onKeyDown}
        />

        {expanded ? (
          <div className="flex items-center justify-between gap-2">
            <div className="hidden min-w-0 truncate text-[10px] text-muted sm:block">
              {backgroundBusy
                ? "另一会话仍在生成中"
                : "回车发送 · Esc 收起 · Shift+回车换行"}
            </div>
            {actionButtons}
          </div>
        ) : (
          <>
            <FileAttachment
              threadId={threadId}
              files={sessionFiles}
              onChange={handleFilesChange}
              onEnsureThread={onEnsureThread}
              onOpenPanel={() => setDocsOpen(true)}
            />
            {actionButtons}
          </>
        )}
      </div>
    </div>
  );
}
