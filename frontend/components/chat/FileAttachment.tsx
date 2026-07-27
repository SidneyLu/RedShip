"use client";

/** 会话附件上传入口；列表详情由 SessionDocsPanel 展示。 */

import { useEffect, useRef, useState } from "react";
import { Paperclip, Loader2, Files } from "lucide-react";
import { api, getApiBase, getToken, apiClientHeaders, type SessionFileItem } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";

interface Props {
  threadId: string | null;
  /** 受控列表；传入后以内源为准 */
  files?: SessionFileItem[];
  onChange?: (files: SessionFileItem[]) => void;
  onEnsureThread?: () => Promise<string | null>;
  /** 已有附件时点击打开分析面板 */
  onOpenPanel?: () => void;
}

export function FileAttachment({
  threadId,
  files: controlledFiles,
  onChange,
  onEnsureThread,
  onOpenPanel,
}: Props) {
  const [localFiles, setLocalFiles] = useState<SessionFileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();
  const files = controlledFiles ?? localFiles;

  useEffect(() => {
    if (controlledFiles !== undefined) return;
    if (!threadId) {
      setLocalFiles([]);
      onChange?.([]);
      return;
    }
    api<SessionFileItem[]>(`/api/threads/${threadId}/files`)
      .then((r) => {
        setLocalFiles(r);
        onChange?.(r);
      })
      .catch(() => {});
  }, [threadId, onChange, controlledFiles]);

  const setFiles = (next: SessionFileItem[]) => {
    if (controlledFiles === undefined) setLocalFiles(next);
    onChange?.(next);
  };

  const upload = async (file: File) => {
    let activeThreadId = threadId;
    if (!activeThreadId && onEnsureThread) {
      activeThreadId = await onEnsureThread();
    }
    if (!activeThreadId) {
      show({ title: "请先创建会话", description: "发送一条消息或等待会话初始化", variant: "destructive" });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const resp = await fetch(`${getApiBase()}/api/threads/${activeThreadId}/files`, {
        method: "POST",
        body: form,
        headers: apiClientHeaders({ Authorization: `Bearer ${getToken() || ""}` }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err);
      }
      const item: SessionFileItem = await resp.json();
      setFiles([item, ...files]);
      onOpenPanel?.();
      const modeHint = item.mode === "files_api" ? "Files API 全文注入" : "会话 RAG 分块索引";
      show({
        title: "文件已就绪",
        description: `${item.filename} · ${modeHint}`,
        variant: "success",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ title: "上传失败", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".md,.markdown,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="btn-ghost"
        title="上传会话附件（PDF / Word / 图片 / 文本，仅本会话可见）"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        添加文件
      </button>
      {files.length > 0 ? (
        <button
          type="button"
          onClick={() => onOpenPanel?.()}
          className="chip hover:border-crimson-200"
          title="查看本会话文档分析"
        >
          <Files className="h-3.5 w-3.5" />
          已附 {files.length} 个文档
        </button>
      ) : null}
    </div>
  );
}

/** 供父组件删除附件时复用 API */
export async function removeSessionFile(threadId: string, fileId: string): Promise<void> {
  await api(`/api/threads/${threadId}/files/${fileId}`, { method: "DELETE" });
}
