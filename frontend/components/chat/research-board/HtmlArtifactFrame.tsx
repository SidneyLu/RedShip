"use client";

/** HTML artifact sandbox (legacy artifact-html). */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Code2 } from "lucide-react";
import type { ArtifactPart } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

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
  artifact: ArtifactPart;
  className?: string;
}

export function HtmlArtifactFrame({ artifact, className }: Props) {
  const [showSource, setShowSource] = useState(false);
  const [srcDoc, setSrcDoc] = useState("");
  const [renderError, setRenderError] = useState(false);

  const tooLarge = useMemo(() => {
    if (!artifact.code) return false;
    return new TextEncoder().encode(artifact.code).length > MAX_CODE_BYTES;
  }, [artifact.code]);

  useEffect(() => {
    setRenderError(false);
    setShowSource(false);
    if (!artifact.code || tooLarge) {
      setSrcDoc("");
      return;
    }
    const delay = artifact.status === "streaming" ? 400 : 0;
    const t = window.setTimeout(() => setSrcDoc(wrapSrcDoc(artifact.code)), delay);
    return () => window.clearTimeout(t);
  }, [artifact.id, artifact.code, artifact.status, tooLarge]);

  if (tooLarge) {
    return (
      <div className={cn("flex flex-col items-center gap-2 p-6 text-center text-sm text-muted", className)}>
        <AlertTriangle className="h-5 w-5 text-crimson-600" />
        可视化代码过大（超过 200KB）
        <button type="button" className="text-crimson-700 underline" onClick={() => setShowSource(true)}>
          查看源码
        </button>
        {showSource ? (
          <pre className="mt-2 max-h-64 w-full overflow-auto bg-ink/95 p-2 text-left text-[11px] text-canvas">
            {artifact.code}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-[280px] flex-col", className)}>
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-crimson-50 hover:text-crimson-800"
        >
          <Code2 className="h-3 w-3" />
          {showSource ? "预览" : "源码"}
        </button>
      </div>
      {showSource ? (
        <pre className="min-h-[240px] flex-1 overflow-auto bg-ink/95 p-3 text-[11px] leading-5 text-canvas">
          {artifact.code}
        </pre>
      ) : renderError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted">
          <AlertTriangle className="h-5 w-5 text-crimson-600" />
          HTML 渲染失败
        </div>
      ) : (
        <iframe
          title={artifact.title}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="min-h-[280px] w-full flex-1 rounded border border-border bg-white"
          onError={() => setRenderError(true)}
        />
      )}
    </div>
  );
}
