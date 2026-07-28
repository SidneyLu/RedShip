"use client";

/** PDF reader with optional 0–1000 bbox overlays. */

import { useEffect, useMemo, useState } from "react";
import { getApiBase, getToken, apiClientHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

export type PdfRect = { page: number; bbox: number[] };

interface Props {
  documentId: string;
  page?: number;
  rects?: PdfRect[];
  highlightText?: string | null;
  className?: string;
}

export function PdfReader({
  documentId,
  page = 1,
  rects = [],
  highlightText,
  className,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(Math.max(1, page));

  useEffect(() => {
    setCurrentPage(Math.max(1, page));
  }, [page]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    const url = `${getApiBase()}/api/knowledge/documents/${documentId}/source/file`;
    setError(null);
    setBlobUrl(null);
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
        revoked = URL.createObjectURL(b);
        setBlobUrl(revoked);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [documentId]);

  const pageRects = useMemo(
    () => rects.filter((r) => Number(r.page) === currentPage && Array.isArray(r.bbox) && r.bbox.length >= 4),
    [rects, currentPage]
  );

  const viewerSrc = blobUrl
    ? `${blobUrl}#page=${currentPage}`
    : null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
        >
          上一页
        </button>
        <span className="text-muted">第 {currentPage} 页</span>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => setCurrentPage((p) => p + 1)}
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
      ) : !viewerSrc ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">加载 PDF…</div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-canvas">
          <iframe title="source-pdf" src={viewerSrc} className="h-full w-full border-0" />
          {pageRects.length > 0 ? (
            <div className="pointer-events-none absolute inset-0">
              {/* Approximate overlay on top of iframe — best-effort for browsers that show PDF in iframe */}
              <div className="relative mx-auto h-full max-w-3xl">
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
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
