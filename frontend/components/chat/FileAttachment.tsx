"use client";

/** 会话附件列表与上传状态展示。 */

import { useEffect, useState, useRef } from "react";
import { Paperclip, FileText, X, Loader2 } from "lucide-react";
import { api, getApiBase, getToken, type SessionFileItem } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";

interface Props {
  threadId: string | null;
  onChange?: (files: SessionFileItem[]) => void;
  onEnsureThread?: () => Promise<string | null>;
}

export function FileAttachment({ threadId, onChange, onEnsureThread }: Props) {
  const [files, setFiles] = useState<SessionFileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (!threadId) {
      setFiles([]);
      onChange?.([]);
      return;
    }
    api<SessionFileItem[]>(`/api/threads/${threadId}/files`)
      .then((r) => {
        setFiles(r);
        onChange?.(r);
      })
      .catch(() => {});
  }, [threadId, onChange]);

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
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err);
      }
      const item: SessionFileItem = await resp.json();
      const next = [item, ...files];
      setFiles(next);
      onChange?.(next);
      show({ title: "文件已加载", description: `${item.filename}（${item.mode}）`, variant: "success" });
    } catch (e: any) {
      show({ title: "上传失败", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    if (!threadId) return;
    try {
      await api(`/api/threads/${threadId}/files/${id}`, { method: "DELETE" });
      const next = files.filter((f) => f.id !== id);
      setFiles(next);
      onChange?.(next);
    } catch (e: any) {
      show({ title: "删除失败", description: String(e?.message || e), variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".md,.markdown,.txt,.pdf,.docx"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="btn-ghost"
        title="上传会话文件（PDF / MD / DOCX）"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        添加文件
      </button>
      {files.map((f) => (
        <div key={f.id} className="chip group relative max-w-[18rem]">
          <FileText className="h-3.5 w-3.5" />
          <span className="truncate" title={f.filename}>
            {f.filename}
          </span>
          <span className="ml-1 text-[10px] uppercase tracking-wider text-crimson-700/80">
            {f.mode === "files_api" ? "Files API" : "RAG"}
          </span>
          <button
            type="button"
            onClick={() => remove(f.id)}
            className="ml-1 rounded-full p-0.5 hover:bg-crimson-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
