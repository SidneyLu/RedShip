"use client";

/** 管理员文档上传组件。 */

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { getApiBase, getToken, apiClientHeaders } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";

interface Props {
  onUploaded?: () => void;
  disabled?: boolean;
}

export function DocumentUploader({ onUploaded, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { show } = useToast();

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const resp = await fetch(`${getApiBase()}/api/knowledge/documents/upload`, {
        method: "POST",
        body: form,
        headers: apiClientHeaders({ Authorization: `Bearer ${getToken() || ""}` }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err);
      }
      show({ title: "文档已入库", description: file.name, variant: "success" });
      onUploaded?.();
    } catch (e: any) {
      show({ title: "上传失败", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".md,.markdown,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <button
        type="button"
        className="btn-primary"
        disabled={disabled || uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        上传知识库文档
      </button>
      <p className="text-xs text-muted">支持 PDF / MD / DOCX / TXT / 图片，仅管理员可用。</p>
    </div>
  );
}
