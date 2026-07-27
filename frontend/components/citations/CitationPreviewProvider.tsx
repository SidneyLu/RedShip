"use client";

/** 全局引用悬停预览浮层上下文。 */

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getThreadMessageCitationPreview,
  type Citation,
  type CitationPreviewCard,
} from "@/lib/api";
import { truncate } from "@/lib/utils";

interface PreviewState {
  citation: Citation;
  rect: DOMRect;
  href: string;
}

interface CitationPreviewContextValue {
  schedulePreview: (citation: Citation, href: string, rect: DOMRect) => void;
  scheduleClose: (delay?: number) => void;
  holdPreview: () => void;
  closeNow: () => void;
}

const CitationPreviewContext = createContext<CitationPreviewContextValue | undefined>(
  undefined
);

const HREF_RE = /^\/threads\/([^/]+)\/messages\/([^/]+)\/citations\/([^/?#]+)$/i;

function parseCitationHref(href: string) {
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, "http://local");
    const match = HREF_RE.exec(url.pathname);
    if (!match) return null;
    return {
      threadId: decodeURIComponent(match[1]),
      messageId: decodeURIComponent(match[2]),
      citationId: decodeURIComponent(match[3]),
    };
  } catch {
    return null;
  }
}

function fallbackCard(citation: Citation, href: string): CitationPreviewCard {
  const excerpt =
    citation.highlight_text || citation.snippet || citation.parent_text || citation.content || "";
  return {
    citation_id: citation.id,
    title: citation.title || citation.heading_path || citation.url || "引用详情",
    subtitle: citation.relative_path || citation.heading_path || citation.site_name || null,
    locator_label: citation.locator_label || citation.heading_path || citation.relative_path || null,
    excerpt: truncate(excerpt, 520),
    score: citation.score ?? null,
    trust_score: citation.score ?? (citation.source_type === "web" ? 0.6 : 0.9),
    href,
    external_url: citation.url || null,
    previewable: citation.previewable ?? Boolean(citation.content || citation.source_type !== "web"),
    preview_mode: (citation.preview_mode as CitationPreviewCard["preview_mode"]) || null,
    media_url: citation.media_url || null,
  };
}

export function CitationPreviewProvider({ children }: { children: ReactNode }) {
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [card, setCard] = useState<CitationPreviewCard | null>(null);
  const [loading, setLoading] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef(new Map<string, CitationPreviewCard>());
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const isHoverEnabled = useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setPreviewState(null);
    setCard(null);
    setLoading(false);
  }, [clearCloseTimer, clearOpenTimer]);

  const schedulePreview = useCallback(
    (citation: Citation, href: string, rect: DOMRect) => {
      if (!isHoverEnabled) return;
      // web：仅在可预览（有抽取正文）时悬停
      if (citation.source_type === "web" && citation.previewable === false) return;
      if (citation.source_type === "web" && !citation.previewable && !citation.content) return;
      clearCloseTimer();
      clearOpenTimer();
      openTimerRef.current = setTimeout(() => {
        setPreviewState({ citation, href, rect });
      }, 280);
    },
    [clearCloseTimer, clearOpenTimer, isHoverEnabled]
  );

  const scheduleClose = useCallback(
    (delay = 180) => {
      clearOpenTimer();
      clearCloseTimer();
      closeTimerRef.current = setTimeout(closeNow, delay);
    },
    [clearCloseTimer, clearOpenTimer, closeNow]
  );

  const holdPreview = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    closeNow();
  }, [pathname, searchKey, closeNow]);

  useEffect(() => {
    const onScroll = () => closeNow();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNow();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeNow]);

  useEffect(() => {
    if (!previewState) return;
    const context = parseCitationHref(previewState.href);
    const fallback = fallbackCard(previewState.citation, previewState.href);
    if (!context) {
      setCard(fallback);
      setLoading(false);
      return;
    }

    const key = `${context.threadId}:${context.messageId}:${context.citationId}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setCard(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setCard(null);
    setLoading(true);
    getThreadMessageCitationPreview(
      context.threadId,
      context.messageId,
      context.citationId,
      "card"
    )
      .then((next) => {
        if (cancelled) return;
        const card = next as CitationPreviewCard;
        cacheRef.current.set(key, card);
        setCard(card);
      })
      .catch(() => {
        if (!cancelled) setCard(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewState]);

  const value = useMemo(
    () => ({ schedulePreview, scheduleClose, holdPreview, closeNow }),
    [schedulePreview, scheduleClose, holdPreview, closeNow]
  );

  const rect = previewState?.rect;
  const style: React.CSSProperties | undefined =
    rect && typeof window !== "undefined"
      ? {
          position: "fixed",
          top: Math.max(16, Math.min(rect.bottom + 12, window.innerHeight - 360)),
          left: Math.min(Math.max(rect.left, 16), window.innerWidth - 536),
          width: Math.min(520, window.innerWidth - 32),
          zIndex: 120,
        }
      : undefined;

  return (
    <CitationPreviewContext.Provider value={value}>
      {children}
      {previewState && style && (
        <a
          href={card?.href || previewState.href}
          className="block rounded-2xl border border-border bg-card shadow-soft"
          style={style}
          onMouseEnter={holdPreview}
          onMouseLeave={() => scheduleClose()}
          onClick={closeNow}
        >
          <article className="max-h-[460px] overflow-hidden rounded-2xl">
            <header className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-muted">
                    {previewState.citation.source_type === "web" ? "网页预览" : "知识库预览"}
                  </div>
                  <div className="mt-1 truncate text-base font-semibold text-crimson-800">
                    {loading ? "正在加载引用预览..." : card?.title || "引用详情"}
                  </div>
                  {card?.subtitle && (
                    <div className="mt-1 truncate text-xs text-muted">{card.subtitle}</div>
                  )}
                </div>
                <div className="shrink-0 rounded-full bg-crimson-50 px-2.5 py-1 text-[11px] font-semibold text-crimson-700">
                  {typeof card?.score === "number"
                    ? `score ${card.score.toFixed(2)}`
                    : `可信度 ${card?.trust_score?.toFixed(2) ?? "--"}`}
                </div>
              </div>
              {card?.locator_label && (
                <div className="mt-3 text-xs text-muted">{card.locator_label}</div>
              )}
            </header>
            <div className="max-h-64 overflow-y-auto px-5 py-4 text-sm leading-7 text-ink scroll-pretty">
              {loading
                ? "正在加载引用预览..."
                : card?.excerpt || "当前引用暂无可展示摘录。"}
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm font-medium text-crimson-700">
              <span className="text-xs font-normal text-muted">
                {card?.external_url ? "可打开原文" : "点击查看完整文档"}
              </span>
              <span>查看详情</span>
            </footer>
          </article>
        </a>
      )}
    </CitationPreviewContext.Provider>
  );
}

export function useCitationPreview() {
  const ctx = useContext(CitationPreviewContext);
  if (!ctx) {
    return {
      schedulePreview: () => {},
      scheduleClose: () => {},
      holdPreview: () => {},
      closeNow: () => {},
    } satisfies CitationPreviewContextValue;
  }
  return ctx;
}
