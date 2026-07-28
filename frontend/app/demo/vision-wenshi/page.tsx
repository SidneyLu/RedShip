"use client";

/**
 * Datalab-style VL OCR demo: left PDF + colored bboxes, right Blocks list.
 * Bidirectional highlight sync. Assets under /demo/gd-wenshi/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PdfReader } from "@/components/reader/PdfReader";
import { ocrBlockColor } from "@/lib/ocrBlockColors";
import { pageHasEstimatedBboxes, repairPageBlocks } from "@/lib/ocrBbox";
import { cn } from "@/lib/utils";

const ASSET_BASE = "/demo/gd-wenshi";

type LayoutBlock = {
  type: string;
  text: string;
  bbox: number[];
  bboxEstimated?: boolean;
};

type LayoutPage = {
  page: number;
  blocks: LayoutBlock[];
};

type LayoutDoc = {
  schema_version?: number;
  norm?: number;
  pages: LayoutPage[];
};

type ReviewDoc = {
  score?: number;
  issues?: string[];
  summary?: string;
  needs_rerun?: boolean;
};

type ResultTab = "blocks" | "markdown";

function extractPageMarkdown(md: string, page: number): string {
  const marker = `<!-- page: ${page} -->`;
  const start = md.indexOf(marker);
  if (start < 0) return md;
  const after = start + marker.length;
  const next = md.indexOf("<!-- page:", after);
  const slice = (next < 0 ? md.slice(after) : md.slice(after, next)).trim();
  return slice || md;
}

export default function VisionWenshiDemoPage() {
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<LayoutDoc | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [review, setReview] = useState<ReviewDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [tab, setTab] = useState<ResultTab>("blocks");
  const blockListRef = useRef<HTMLUListElement | null>(null);
  const blockRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [layoutRes, mdRes, reviewRes] = await Promise.all([
          fetch(`${ASSET_BASE}/layout.json`),
          fetch(`${ASSET_BASE}/content.md`),
          fetch(`${ASSET_BASE}/review.json`),
        ]);
        if (!layoutRes.ok) {
          throw new Error(
            `缺少 layout.json（HTTP ${layoutRes.status}）。请先跑 demo_vision_pdf_10pages.py`
          );
        }
        if (!mdRes.ok) {
          throw new Error(`缺少 content.md（HTTP ${mdRes.status}）`);
        }
        const layoutJson = (await layoutRes.json()) as LayoutDoc;
        const mdText = await mdRes.text();
        let reviewJson: ReviewDoc | null = null;
        if (reviewRes.ok) {
          reviewJson = (await reviewRes.json()) as ReviewDoc;
        }
        if (cancelled) return;
        setLayout(layoutJson);
        setMarkdown(mdText);
        setReview(reviewJson);
        setPage(layoutJson.pages?.[0]?.page ?? 1);
      } catch (e) {
        if (!cancelled) setError(String((e as Error)?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const pageCount = layout?.pages?.length ?? 0;
  const currentBlocks = useMemo(() => {
    const p = layout?.pages?.find((x) => x.page === page);
    return repairPageBlocks(p?.blocks ?? []);
  }, [layout, page]);

  const estimated = pageHasEstimatedBboxes(currentBlocks);

  const pageMarkdown = useMemo(
    () => extractPageMarkdown(markdown, page),
    [markdown, page]
  );

  const goTo = useCallback(
    (next: number) => {
      if (pageCount <= 0) return;
      const capped = Math.min(Math.max(1, next), pageCount);
      setPage(capped);
      setActiveIdx(null);
    },
    [pageCount]
  );

  const selectBlock = useCallback((idx: number) => {
    setActiveIdx(idx);
    setTab("blocks");
  }, []);

  useEffect(() => {
    if (activeIdx == null) return;
    const el = blockRefs.current.get(activeIdx);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIdx, page]);

  const ready = mounted && !loading && !error && layout;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-transparent" suppressHydrationWarning>
      <header className="shrink-0 border-b border-border/70 bg-canvas/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-crimson-800">广东文史 VL Demo</h1>
              <span className="chip">qwen3.5-flash · 300 DPI · 前 10 页</span>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              左原文 + OCR 框，右 Blocks；点击任一侧可双向高亮定位。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mounted && review?.score != null ? (
              <span
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs",
                  review.needs_rerun
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                )}
                title={review.summary || ""}
              >
                review {Number(review.score).toFixed(2)}
                {review.needs_rerun ? " · 需重跑" : ""}
              </span>
            ) : null}
            <Link href="/knowledge" className="btn-ghost text-sm">
              ← 知识库
            </Link>
          </div>
        </div>
      </header>

      {!ready ? (
        <div className="m-4 flex flex-1 items-center justify-center panel text-sm text-muted">
          {!mounted || loading ? "加载 demo 产物…" : error}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={page <= 1}
                onClick={() => goTo(page - 1)}
              >
                Prev
              </button>
              <span className="min-w-[7rem] text-center text-muted">
                Page {page} / {pageCount}
              </span>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={page >= pageCount}
                onClick={() => goTo(page + 1)}
              >
                Next
              </button>
              <span className="hidden text-xs text-muted sm:inline">
                · {currentBlocks.length} blocks
              </span>
              {estimated ? (
                <span
                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900"
                  title="本页 VL 返回了整页占位 bbox，已按阅读顺序估算定位（非精标）"
                >
                  bbox 估算
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  tab === "blocks"
                    ? "bg-crimson-50 text-crimson-800"
                    : "text-muted hover:text-ink"
                )}
                onClick={() => setTab("blocks")}
              >
                Blocks
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  tab === "markdown"
                    ? "bg-crimson-50 text-crimson-800"
                    : "text-muted hover:text-ink"
                )}
                onClick={() => setTab("markdown")}
              >
                Markdown
              </button>
            </div>
          </div>

          <main className="flex min-h-0 flex-1">
            <section className="flex min-h-0 w-1/2 min-w-0 flex-col border-r border-border bg-card">
              <PdfReader
                pdfUrl={`${ASSET_BASE}/source.pdf`}
                page={page}
                pageCount={pageCount || undefined}
                hidePager
                layoutBlocks={currentBlocks}
                activeBlockIndex={activeIdx}
                onBlockClick={selectBlock}
                className="min-h-0"
              />
            </section>

            <section className="flex min-h-0 w-1/2 min-w-0 flex-col bg-card">
              {tab === "markdown" ? (
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  <article className="report-markdown prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{pageMarkdown}</ReactMarkdown>
                  </article>
                </div>
              ) : (
                <ul ref={blockListRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
                  {currentBlocks.length === 0 ? (
                    <li className="text-sm text-muted">本页无抽取块</li>
                  ) : (
                    currentBlocks.map((b, i) => {
                      const color = ocrBlockColor(b.type);
                      const active = activeIdx === i;
                      return (
                        <li
                          key={`${page}-${i}`}
                          ref={(el) => {
                            if (el) blockRefs.current.set(i, el);
                            else blockRefs.current.delete(i);
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => selectBlock(i)}
                            className={cn(
                              "flex w-full gap-2 rounded-xl border px-3 py-2 text-left transition",
                              active
                                ? "border-crimson-400 bg-crimson-50/80 shadow-sm"
                                : "border-border bg-canvas/50 hover:border-crimson-200 hover:bg-crimson-50/30"
                            )}
                          >
                            <span
                              className="mt-0.5 w-1 shrink-0 self-stretch rounded-full"
                              style={{ backgroundColor: color.bar }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "mb-1 block text-[10px] font-semibold uppercase tracking-wide",
                                  color.label
                                )}
                              >
                                {b.type || "text"}
                              </span>
                              <span className="block whitespace-pre-wrap text-sm leading-6 text-ink">
                                {b.text}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </section>
          </main>
        </>
      )}
    </div>
  );
}
