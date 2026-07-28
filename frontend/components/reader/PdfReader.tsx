"use client";

/** PDF reader via pdf.js canvas — page controls stay in sync with parent state. */

import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBase, getToken, apiClientHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

export type PdfRect = { page: number; bbox: number[] };

interface Props {
  /** Knowledge-base document id (fetches /api/knowledge/documents/{id}/source/file). */
  documentId?: string;
  /** Static or absolute PDF URL; when set, skips API fetch. */
  pdfUrl?: string;
  page?: number;
  /** When set, disables next beyond this page. */
  pageCount?: number;
  onPageChange?: (page: number) => void;
  rects?: PdfRect[];
  highlightText?: string | null;
  className?: string;
}

export function PdfReader({
  documentId,
  pdfUrl,
  page = 1,
  pageCount,
  onPageChange,
  rects = [],
  highlightText,
  className,
}: Props) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(Math.max(1, page));
  const [docPages, setDocPages] = useState(0);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    setCurrentPage(Math.max(1, page));
  }, [page]);

  const effectiveCount = pageCount && pageCount > 0 ? pageCount : docPages || 0;

  const goTo = (next: number) => {
    const capped =
      effectiveCount > 0
        ? Math.min(Math.max(1, next), effectiveCount)
        : Math.max(1, next);
    setCurrentPage(capped);
    onPageChange?.(capped);
  };

  // Resolve PDF bytes URL (static path or authenticated blob)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    if (pdfUrl) {
      revoke();
      setError(null);
      setSourceUrl(pdfUrl);
      return () => {
        cancelled = true;
      };
    }

    if (!documentId) {
      setError("缺少 documentId 或 pdfUrl");
      setSourceUrl(null);
      return;
    }

    const url = `${getApiBase()}/api/knowledge/documents/${documentId}/source/file`;
    setError(null);
    setSourceUrl(null);
    fetch(url, {
      headers: apiClientHeaders({ Authorization: `Bearer ${getToken() || ""}` }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.text();
          throw new Error(body || `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then((b) => {
        if (cancelled) return;
        revoke();
        const obj = URL.createObjectURL(b);
        objectUrlRef.current = obj;
        setSourceUrl(obj);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });

    return () => {
      cancelled = true;
      revoke();
    };
  }, [documentId, pdfUrl, ready]);

  // Load PDF document once source URL is ready
  useEffect(() => {
    if (!ready || !sourceUrl) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        if (pdfRef.current) {
          await pdfRef.current.destroy().catch(() => undefined);
          pdfRef.current = null;
        }
        setDocPages(0);
        const loadingTask = pdfjs.getDocument(sourceUrl);
        const pdf = await loadingTask.promise;
        if (cancelled) {
          await pdf.destroy().catch(() => undefined);
          return;
        }
        pdfRef.current = pdf;
        setDocPages(pdf.numPages);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String((e as Error)?.message || e));
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      const doc = pdfRef.current;
      pdfRef.current = null;
      doc?.destroy().catch(() => undefined);
    };
  }, [sourceUrl, ready]);

  // Render current page to canvas
  useEffect(() => {
    if (!ready || !pdfRef.current || !canvasRef.current) return;
    let cancelled = false;
    const pdf = pdfRef.current;
    const pageNum = Math.min(Math.max(1, currentPage), pdf.numPages || currentPage);

    (async () => {
      setRendering(true);
      try {
        renderTaskRef.current?.cancel();
        const pdfPage = await pdf.getPage(pageNum);
        if (cancelled) return;

        const container = containerRef.current;
        const base = pdfPage.getViewport({ scale: 1 });
        const maxWidth = Math.max(280, (container?.clientWidth || 720) - 24);
        const scale = Math.min(2.5, maxWidth / base.width);
        const viewport = pdfPage.getViewport({ scale });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        if (!cancelled && !msg.includes("Rendering cancelled")) {
          setError(msg);
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [currentPage, docPages, sourceUrl, ready]);

  const pageRects = useMemo(
    () =>
      rects.filter(
        (r) => Number(r.page) === currentPage && Array.isArray(r.bbox) && r.bbox.length >= 4
      ),
    [rects, currentPage]
  );

  const atLast = effectiveCount > 0 ? currentPage >= effectiveCount : false;
  const showLoading = !ready || (!sourceUrl && !error) || (sourceUrl && docPages === 0 && !error);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          disabled={currentPage <= 1 || showLoading}
          onClick={() => goTo(currentPage - 1)}
        >
          上一页
        </button>
        <span className="text-muted">
          第 {currentPage} 页
          {effectiveCount > 0 ? ` / ${effectiveCount}` : ""}
          {rendering ? " · 渲染中" : ""}
        </span>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          disabled={atLast || showLoading}
          onClick={() => goTo(currentPage + 1)}
        >
          下一页
        </button>
        {highlightText ? (
          <span className="ml-auto max-w-[40%] truncate text-xs text-muted" title={highlightText}>
            高亮：{highlightText}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-crimson-700">
          无法加载源 PDF：{error}
        </div>
      ) : showLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">加载 PDF…</div>
      ) : (
        <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto bg-canvas">
          <div className="relative mx-auto w-fit p-3">
            <canvas ref={canvasRef} className="block max-w-full shadow-sm" />
            {pageRects.length > 0 ? (
              <div className="pointer-events-none absolute inset-3">
                {pageRects.map((r, i) => {
                  const [x0, y0, x1, y1] = r.bbox;
                  const left = (x0 / 1000) * 100;
                  const top = (y0 / 1000) * 100;
                  const width = ((x1 - x0) / 1000) * 100;
                  const height = ((y1 - y0) / 1000) * 100;
                  return (
                    <div
                      key={i}
                      className="absolute rounded-sm border border-crimson-500/70 bg-crimson-400/25"
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${Math.max(width, 0.5)}%`,
                        height: `${Math.max(height, 0.5)}%`,
                      }}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
