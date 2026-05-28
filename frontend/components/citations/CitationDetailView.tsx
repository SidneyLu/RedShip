"use client";

/** 引用详情页主体：展示命中摘录、父块上下文与来源元数据。 */

import type { ReactNode } from "react";
import type { Citation, CitationPreviewPage } from "@/lib/api";

interface Props {
  citation?: Citation | null;
  preview?: CitationPreviewPage | null;
}

function highlightContent(text: string, highlight: string | null | undefined): ReactNode {
  const needle = (highlight || "").trim();
  if (!needle) return text;

  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-[#ffe7b8] px-1 text-ink">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function metadataRows(preview: CitationPreviewPage | null | undefined, citation: Citation | null | undefined) {
  const raw = preview?.metadata || {
    doc_id: citation?.doc_id,
    relative_path: citation?.relative_path,
    heading_path: citation?.heading_path,
    era: citation?.era,
    series: citation?.series,
    parent_index: citation?.parent_index,
    source_type: citation?.source_type,
  };
  return Object.entries(raw || {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
}

export function CitationDetailView({ citation, preview }: Props) {
  const sourceType = citation?.source_type || (preview?.preview_mode === "web" ? "web" : "kb");
  const title = preview?.title || citation?.title || citation?.heading_path || "引用详情";
  const locator = preview?.locator_label || citation?.locator_label || citation?.heading_path;
  const body =
    preview?.content ||
    citation?.content ||
    citation?.parent_text ||
    citation?.highlight_text ||
    citation?.snippet ||
    "";
  const highlight = preview?.highlight_text || citation?.highlight_text || citation?.snippet;
  const excerpt = preview?.excerpt || citation?.snippet || citation?.highlight_text || "";
  const externalUrl = preview?.external_url || citation?.url;
  const rows = metadataRows(preview, citation);

  return (
    <article className="space-y-4">
      <section className="panel p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-muted">
              {sourceType === "web" ? "网络来源" : "知识库文档"}
            </div>
            <h2 className="mt-1 text-2xl font-semibold text-crimson-800">{title}</h2>
            {preview?.subtitle && <div className="mt-1 text-sm text-muted">{preview.subtitle}</div>}
            {locator && <div className="mt-2 text-sm text-muted">{locator}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {citation?.ordinal && <span className="chip whitespace-nowrap">#{citation.ordinal}</span>}
            {typeof preview?.score === "number" && (
              <span className="rounded-full bg-crimson-50 px-2.5 py-1 text-xs font-semibold text-crimson-700">
                score {preview.score.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
          {preview?.preview_mode && (
            <span className="rounded-full border border-border bg-canvas px-3 py-1">
              {preview.preview_mode === "web" ? "网页引用" : "文本资料"}
              {preview.page_hint ? ` · 第 ${preview.page_hint} 块` : ""}
            </span>
          )}
          {typeof preview?.trust_score === "number" && (
            <span className="rounded-full border border-crimson-200 bg-crimson-50 px-3 py-1 text-crimson-700">
              可信度 {preview.trust_score.toFixed(2)}
            </span>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <article className="panel p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-crimson-700">命中摘录</p>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink">
              {highlightContent(excerpt || highlight || "暂无摘录。", highlight)}
            </div>
          </article>

          {rows.length > 0 && (
            <article className="panel p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-crimson-700">定位信息</p>
              <dl className="mt-3 space-y-2 text-sm">
                {rows.map(([key, value]) => (
                  <div key={key} className="rounded-xl border border-border bg-canvas/60 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wider text-muted">{key}</dt>
                    <dd className="mt-1 break-all text-ink">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )}

          {externalUrl && (
            <article className="panel p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-crimson-700">原始来源</p>
              <a
                className="mt-3 inline-flex text-sm text-crimson-700 underline-offset-2 hover:underline"
                href={externalUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                打开原始链接
              </a>
            </article>
          )}
        </aside>

        <article className="panel overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-crimson-700">上下文正文</p>
            <p className="mt-2 text-sm text-muted">展示当前引用命中的父块上下文，用于回到原文附近核对。</p>
          </div>
          <div className="max-h-[72vh] overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm leading-8 text-ink scroll-pretty">
            {body ? highlightContent(body, highlight) : "当前引用暂无更完整的上下文内容。"}
          </div>
        </article>
      </section>
    </article>
  );
}
