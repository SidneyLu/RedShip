"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Citation } from "@/lib/api";
import { truncate } from "@/lib/utils";

interface PreviewState {
  citation: Citation | null;
  rect: DOMRect | null;
}

interface CitationPreviewContextValue {
  showPreview: (citation: Citation, rect: DOMRect) => void;
  hidePreview: () => void;
}

const CitationPreviewContext = createContext<CitationPreviewContextValue | undefined>(
  undefined
);

export function CitationPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewState>({ citation: null, rect: null });

  const showPreview = useCallback((citation: Citation, rect: DOMRect) => {
    setState({ citation, rect });
  }, []);

  const hidePreview = useCallback(() => setState({ citation: null, rect: null }), []);

  const value = useMemo(() => ({ showPreview, hidePreview }), [showPreview, hidePreview]);

  const c = state.citation;
  const r = state.rect;

  const style: React.CSSProperties | undefined = r
    ? {
        position: "fixed",
        top: Math.min(r.bottom + 8, window.innerHeight - 240),
        left: Math.min(
          Math.max(r.left, 16),
          window.innerWidth - 432
        ),
        width: 416,
        zIndex: 90,
      }
    : undefined;

  return (
    <CitationPreviewContext.Provider value={value}>
      {children}
      {c && style && (
        <div
          className="rounded-2xl border border-border bg-card p-4 shadow-soft"
          style={style}
          onMouseEnter={() => showPreview(c, r!)}
          onMouseLeave={hidePreview}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted">
                {c.source_type === "web" ? "网络来源" : "知识库"}
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold text-crimson-800">
                {c.title || c.heading_path || c.url || "来源详情"}
              </div>
              {c.heading_path && (
                <div className="truncate text-xs text-muted">{c.heading_path}</div>
              )}
            </div>
            <div className="shrink-0 text-[10px] uppercase tracking-wider text-muted">
              #{c.ordinal}
            </div>
          </div>
          <div className="mt-3 max-h-32 overflow-auto rounded-xl bg-canvas/60 p-2 text-xs leading-6 text-ink scroll-pretty">
            {truncate(c.highlight_text || c.snippet || c.parent_text || "", 360)}
          </div>
          {c.url && (
            <a
              className="mt-3 inline-block truncate text-xs text-crimson-700 underline-offset-2 hover:underline"
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {c.url}
            </a>
          )}
        </div>
      )}
    </CitationPreviewContext.Provider>
  );
}

export function useCitationPreview() {
  const ctx = useContext(CitationPreviewContext);
  if (!ctx) {
    return {
      showPreview: () => {},
      hidePreview: () => {},
    } satisfies CitationPreviewContextValue;
  }
  return ctx;
}
