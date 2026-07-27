"use client";

/** 深度研究可视化沙箱：iframe 隔离渲染模型生成的 HTML。 */

import { useEffect, useMemo, useState } from "react";
import { X, Code2, LayoutDashboard, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactPart } from "@/lib/chat-types";

const MAX_CODE_BYTES = 200 * 1024;

function wrapSrcDoc(code: string): string {
  const trimmed = code.trim();
  if (/<!DOCTYPE html>/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { margin: 0; padding: 12px; font-family: "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif; color: #1a1a1a; background: #fff; }
</style>
</head>
<body>${trimmed}</body>
</html>`;
}

interface Props {
  artifact: ArtifactPart | null;
  onClose: () => void;
  className?: string;
  /** 移动端抽屉样式 */
  variant?: "panel" | "drawer";
}

export function ResearchCanvas({ artifact, onClose, className, variant = "panel" }: Props) {
  const [showSource, setShowSource] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [srcDoc, setSrcDoc] = useState("");

  const tooLarge = useMemo(() => {
    if (!artifact?.code) return false;
    return new TextEncoder().encode(artifact.code).length > MAX_CODE_BYTES;
  }, [artifact?.code]);

  useEffect(() => {
    setRenderError(false);
    setShowSource(false);
    if (!artifact?.code || tooLarge) {
      setSrcDoc("");
      return;
    }
    // 流式时节流：仅当 done 或代码长度跨过阈值时更新
    const delay = artifact.status === "streaming" ? 400 : 0;
    const t = window.setTimeout(() => {
      setSrcDoc(wrapSrcDoc(artifact.code));
    }, delay);
    return () => window.clearTimeout(t);
  }, [artifact?.id, artifact?.code, artifact?.status, tooLarge]);

  if (!artifact) return null;

  const body = (
    <>
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-crimson-700">
            <LayoutDashboard className="h-3 w-3" />
            研究画布
            {artifact.status === "streaming" ? " · 生成中" : ""}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-ink">{artifact.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="rounded-lg p-1.5 text-muted hover:bg-crimson-50 hover:text-crimson-800"
            title="查看源码"
          >
            <Code2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-crimson-50 hover:text-crimson-800"
            aria-label="关闭画布"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {tooLarge ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
          <AlertTriangle className="h-5 w-5 text-crimson-600" />
          可视化代码过大（超过 200KB），已跳过沙箱渲染。
          <button type="button" className="text-crimson-700 underline" onClick={() => setShowSource(true)}>
            查看源码
          </button>
        </div>
      ) : showSource ? (
        <pre className="min-h-0 flex-1 overflow-auto bg-ink/95 p-3 text-[11px] leading-5 text-canvas">
          {artifact.code}
        </pre>
      ) : renderError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
          <AlertTriangle className="h-5 w-5 text-crimson-600" />
          可视化渲染失败
          <button type="button" className="text-crimson-700 underline" onClick={() => setShowSource(true)}>
            查看源码
          </button>
        </div>
      ) : (
        <iframe
          title={artifact.title}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="min-h-0 w-full flex-1 border-0 bg-white"
          onError={() => setRenderError(true)}
        />
      )}
    </>
  );

  if (variant === "drawer") {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-ink/30 lg:hidden" onClick={onClose}>
        <aside
          className={cn(
            "flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-soft",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </aside>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "panel hidden min-h-[calc(100vh-1rem)] w-full max-w-md shrink-0 flex-col overflow-hidden lg:flex",
        className
      )}
    >
      {body}
    </aside>
  );
}
