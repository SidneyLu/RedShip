"use client";

/**
 * Static VL OCR demo: left PDF, right OCR text / markdown.
 * Assets under /demo/gd-wenshi/ — no login or knowledge-base ingest required.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PdfReader } from "@/components/reader/PdfReader";
import { cn } from "@/lib/utils";

const ASSET_BASE = "/demo/gd-wenshi";

type LayoutBlock = {
  type: string;
  text: string;
};

type LayoutPage = {
  page: number;
  blocks: LayoutBlock[];
};

type LayoutDoc = {
  schema_version?: number;
  pages: LayoutPage[];
};

type ReviewDoc = {
  score?: number;
  issues?: string[];
  summary?: string;
  needs_rerun?: boolean;
};

export default function VisionWenshiDemoPage() {
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<LayoutDoc | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [review, setReview] = useState<ReviewDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showMd, setShowMd] = useState(false);

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
    return p?.blocks ?? [];
  }, [layout, page]);

  const onPageChange = useCallback((p: number) => {
    setPage(p);
  }, []);

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
              扫描 PDF → 版面 OCR（繁体转简体）→ Markdown。左原文，右抽取结果。
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

      <main className="flex min-h-0 flex-1 gap-0">
        {!mounted || loading ? (
          <div className="m-4 flex flex-1 items-center justify-center panel text-sm text-muted">
            加载 demo 产物…
          </div>
        ) : error ? (
          <div className="m-4 flex flex-1 items-center justify-center panel p-8 text-sm text-crimson-700">
            {error}
          </div>
        ) : (
          <>
            <section className="flex min-h-0 w-1/2 min-w-0 flex-col border-r border-border bg-card">
              <PdfReader
                pdfUrl={`${ASSET_BASE}/source.pdf`}
                page={page}
                pageCount={pageCount || undefined}
                onPageChange={onPageChange}
                className="min-h-0"
              />
            </section>

            <section className="flex min-h-0 w-1/2 min-w-0 flex-col bg-card">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="text-sm font-medium text-ink">
                  第 {page} 页 · {currentBlocks.length} 块
                </div>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => setShowMd((v) => !v)}
                >
                  {showMd ? "看块列表" : "看全文 MD"}
                </button>
              </div>

              {showMd ? (
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  <article className="report-markdown prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                  </article>
                </div>
              ) : (
                <ul className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
                  {currentBlocks.length === 0 ? (
                    <li className="text-sm text-muted">本页无抽取块</li>
                  ) : (
                    currentBlocks.map((b, i) => (
                      <li
                        key={`${page}-${i}`}
                        className="rounded-xl border border-border bg-canvas/60 px-3 py-2"
                      >
                        <span className="mb-1 inline-block rounded bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                          {b.type}
                        </span>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{b.text}</p>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
