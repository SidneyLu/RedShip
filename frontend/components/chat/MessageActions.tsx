"use client";

/** 助手消息操作：复制全文、导出 md/docx/pdf。 */

import { useState, useRef, useEffect } from "react";
import { Copy, Check, Download, ChevronDown, Loader2 } from "lucide-react";
import { getApiBase, getToken, apiClientHeaders } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";
import { cn } from "@/lib/utils";

type ExportFormat = "md" | "docx" | "pdf";

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "md", label: "Markdown (.md)" },
  { id: "docx", label: "Word (.docx)" },
  { id: "pdf", label: "PDF (.pdf)" },
];

interface Props {
  threadId: string;
  messageId: string;
  text: string;
  emphasizeExport?: boolean;
  className?: string;
}

export function MessageActions({
  threadId,
  messageId,
  text,
  emphasizeExport,
  className,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      show({ title: "复制失败", variant: "destructive" });
    }
  };

  const exportDoc = async (format: ExportFormat) => {
    setExporting(format);
    setOpen(false);
    try {
      const url = `${getApiBase()}/api/threads/${threadId}/messages/${messageId}/export?format=${format}`;
      const resp = await fetch(url, {
        headers: apiClientHeaders({ Authorization: `Bearer ${getToken() || ""}` }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const cd = resp.headers.get("Content-Disposition") || "";
      const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
      const filename = match
        ? decodeURIComponent(match[1].replace(/"/g, ""))
        : `export.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      show({ title: "已开始下载", description: filename, variant: "success" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ title: "导出失败", description: msg, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (!text.trim()) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 pt-2", className)}>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:border-crimson-200 hover:text-crimson-800"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "已复制" : "复制"}
      </button>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={Boolean(exporting)}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition",
            emphasizeExport
              ? "border-crimson-200 bg-crimson-50 text-crimson-800 hover:bg-crimson-100"
              : "border-border text-muted hover:border-crimson-200 hover:text-crimson-800"
          )}
        >
          {exporting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          导出
          <ChevronDown className="h-3 w-3" />
        </button>
        {open ? (
          <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-soft">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => void exportDoc(f.id)}
                className="block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-crimson-50"
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
