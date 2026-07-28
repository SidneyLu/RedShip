"use client";

import { useMemo, useState } from "react";
import type { ArtifactPart } from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import { VizFigure } from "./VizFigure";
import { AlertTriangle, Code2 } from "lucide-react";

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

function parseVizFromCode(code: string) {
  try {
    return JSON.parse(code) as ArtifactPart["viz"];
  } catch {
    return null;
  }
}

interface Props {
  artifacts: ArtifactPart[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}

export function ReportFiguresPanel({ artifacts, activeId, onSelect }: Props) {
  const figures = useMemo(
    () => artifacts.filter((a) => a.format === "viz" || a.format === "html"),
    [artifacts]
  );
  const [showSource, setShowSource] = useState(false);

  if (!figures.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
        <p>暂无报告附图</p>
        <p className="text-xs">研究报告生成图表后将显示在此（类论文附图）。</p>
      </div>
    );
  }

  const selected =
    figures.find((f) => f.id === activeId) ||
    figures.find((f) => f.status === "streaming") ||
    figures[figures.length - 1];

  const tooLarge =
    selected?.code &&
    new TextEncoder().encode(selected.code).length > MAX_CODE_BYTES;

  const viz =
    selected.format === "viz"
      ? selected.viz || parseVizFromCode(selected.code)
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {figures.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect?.(f.id)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors",
              f.id === selected.id
                ? "bg-crimson-50 text-crimson-800"
                : "text-muted hover:bg-canvas hover:text-ink"
            )}
          >
            图 {i + 1}
            {f.status === "streaming" ? " ·" : ""} {f.title}
          </button>
        ))}
        {selected.format === "html" ? (
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="ml-auto shrink-0 rounded-md p-1.5 text-muted hover:bg-crimson-50 hover:text-crimson-800"
            title="查看源码"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selected.status === "streaming" && selected.format === "viz" && !viz ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            附图生成中…
          </div>
        ) : tooLarge ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
            <AlertTriangle className="h-5 w-5 text-crimson-600" />
            可视化代码过大（超过 200KB）
          </div>
        ) : showSource && selected.format === "html" ? (
          <pre className="overflow-auto rounded-lg bg-ink/95 p-3 text-[11px] leading-5 text-canvas">
            {selected.code}
          </pre>
        ) : selected.format === "viz" ? (
          <VizFigure viz={viz} title={selected.title} height={360} />
        ) : (
          <iframe
            title={selected.title}
            sandbox="allow-scripts"
            srcDoc={wrapSrcDoc(selected.code)}
            className="min-h-[360px] w-full rounded-lg border border-border bg-white"
          />
        )}
      </div>
    </div>
  );
}
