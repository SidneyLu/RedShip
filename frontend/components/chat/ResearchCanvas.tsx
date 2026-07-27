"use client";

/** 深度研究可视化沙箱：iframe 隔离渲染；桌面为可拖动/缩放浮动窗。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Code2, LayoutDashboard, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactPart } from "@/lib/chat-types";

const MAX_CODE_BYTES = 200 * 1024;
const GEOM_KEY = "redship.canvas.geom";
const MIN_W = 320;
const MIN_H = 280;

type Geom = { x: number; y: number; w: number; h: number };

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

function defaultGeom(): Geom {
  if (typeof window === "undefined") {
    return { x: 40, y: 40, w: 420, h: 520 };
  }
  const w = Math.min(420, Math.round(window.innerWidth * 0.4));
  const h = Math.min(640, Math.round(window.innerHeight * 0.7));
  const x = Math.max(8, window.innerWidth - w - 16);
  const y = 16;
  return { x, y, w, h };
}

function loadGeom(): Geom {
  try {
    const raw = window.localStorage.getItem(GEOM_KEY);
    if (!raw) return defaultGeom();
    const parsed = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.w !== "number" ||
      typeof parsed.h !== "number"
    ) {
      return defaultGeom();
    }
    return clampGeom(parsed as Geom);
  } catch {
    return defaultGeom();
  }
}

function clampGeom(g: Geom): Geom {
  if (typeof window === "undefined") return g;
  const maxW = Math.max(MIN_W, window.innerWidth - 16);
  const maxH = Math.max(MIN_H, window.innerHeight - 16);
  const w = Math.min(maxW, Math.max(MIN_W, g.w));
  const h = Math.min(maxH, Math.max(MIN_H, g.h));
  const x = Math.min(Math.max(0, g.x), window.innerWidth - w);
  const y = Math.min(Math.max(0, g.y), window.innerHeight - h);
  return { x, y, w, h };
}

function saveGeom(g: Geom) {
  try {
    window.localStorage.setItem(GEOM_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
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
  const [geom, setGeom] = useState<Geom>(() =>
    typeof window === "undefined" ? defaultGeom() : loadGeom()
  );
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: Geom;
  } | null>(null);

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
    const delay = artifact.status === "streaming" ? 400 : 0;
    const t = window.setTimeout(() => {
      setSrcDoc(wrapSrcDoc(artifact.code));
    }, delay);
    return () => window.clearTimeout(t);
  }, [artifact?.id, artifact?.code, artifact?.status, tooLarge]);

  useEffect(() => {
    const onResize = () => setGeom((g) => clampGeom(g));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.mode === "move") {
      setGeom(clampGeom({ ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy }));
    } else {
      setGeom(
        clampGeom({
          ...drag.orig,
          w: drag.orig.w + dx,
          h: drag.orig.h + dy,
        })
      );
    }
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    setGeom((g) => {
      const next = clampGeom(g);
      saveGeom(next);
      return next;
    });
  }, []);

  const startDrag = (mode: "move" | "resize", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...geom },
    };
    setDragging(true);
  };
  if (!artifact) return null;

  const body = (
    <>
      <header
        className={cn(
          "flex items-start justify-between gap-2 border-b border-border px-4 py-3",
          variant === "panel" && "cursor-grab active:cursor-grabbing select-none"
        )}
        onPointerDown={variant === "panel" ? (e) => startDrag("move", e) : undefined}
        onPointerMove={variant === "panel" ? onPointerMove : undefined}
        onPointerUp={variant === "panel" ? endDrag : undefined}
        onPointerCancel={variant === "panel" ? endDrag : undefined}
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-crimson-700">
            <LayoutDashboard className="h-3 w-3" />
            研究画布
            {artifact.status === "streaming" ? " · 生成中" : ""}
            {variant === "panel" ? " · 可拖动" : ""}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-ink">{artifact.title}</h3>
        </div>
        <div
          className="flex shrink-0 items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
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
          className={cn(
            "min-h-0 w-full flex-1 border-0 bg-white",
            dragging && "pointer-events-none"
          )}
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
        "panel fixed z-30 hidden flex-col overflow-hidden shadow-soft lg:flex",
        className
      )}
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
      }}
    >
      {body}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onPointerDown={(e) => startDrag("resize", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-hidden
      >
        <span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-crimson-400/80" />
      </div>
    </aside>
  );
}
