"use client";

/** 本会话文档分析面板：路径说明、块数、体积、就绪状态。 */

import { FileText, Image as ImageIcon, Trash2, ChevronDown, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionFileItem } from "@/lib/api";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

function formatBytes(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function modeLabel(mode: SessionFileItem["mode"]): { title: string; hint: string } {
  if (mode === "files_api") {
    return {
      title: "Files API",
      hint: "全文注入模型上下文，适合中短文档即时问答",
    };
  }
  return {
    title: "会话 RAG",
    hint: "已解析分块并建索引，按问题检索相关段落",
  };
}

interface Props {
  files: SessionFileItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove?: (id: string) => void;
  className?: string;
}

export function SessionDocsPanel({ files, open, onOpenChange, onRemove, className }: Props) {
  if (files.length === 0) return null;

  return (
    <div className={cn("rounded-2xl border border-border bg-card/80", className)}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-crimson-700">
            本会话文档
          </p>
          <p className="mt-0.5 text-sm text-muted">
            已附 {files.length} 个文档 · 仅本会话可见，可用于分析与撰写
          </p>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <ul className="space-y-2 border-t border-border/70 px-3 py-3">
          {files.map((f) => {
            const ml = modeLabel(f.mode);
            const isImage = IMAGE_EXT.test(f.filename);
            return (
              <li
                key={f.id}
                className="flex gap-3 rounded-xl border border-border/80 bg-canvas/40 px-3 py-2.5"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-crimson-50 text-crimson-700">
                  {isImage ? (
                    <ImageIcon className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink" title={f.filename}>
                      {f.filename}
                    </p>
                    {onRemove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(f.id)}
                        className="rounded-lg p-1 text-muted hover:bg-crimson-50 hover:text-crimson-700"
                        title="移除附件"
                        aria-label={`移除 ${f.filename}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-crimson-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-crimson-700">
                      {ml.title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      {f.status === "ready" ? "已就绪" : f.status}
                    </span>
                    <span className="text-[10px] text-muted">{formatBytes(f.size_bytes)}</span>
                    {f.mode === "session_rag" && f.chunks_count > 0 ? (
                      <span className="text-[10px] text-muted">{f.chunks_count} 块</span>
                    ) : null}
                    {f.created_at ? (
                      <span className="text-[10px] text-muted">{formatTime(f.created_at)}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">{ml.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
