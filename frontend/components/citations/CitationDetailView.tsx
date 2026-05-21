"use client";

/** 引用详情页主体：展示 parent_text、来源元数据。 */

import type { Citation } from "@/lib/api";

export function CitationDetailView({ citation }: { citation: Citation }) {
  const body =
    citation.content || citation.parent_text || citation.highlight_text || citation.snippet || "";

  return (
    <article className="panel p-6">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">
            {citation.source_type === "web" ? "网络来源" : "知识库"}
          </div>
          <h2 className="mt-1 text-xl font-semibold text-crimson-800">
            {citation.title || citation.heading_path || "引用详情"}
          </h2>
          {citation.heading_path && (
            <div className="mt-1 text-sm text-muted">{citation.heading_path}</div>
          )}
          {citation.era && (
            <div className="mt-1 text-xs text-muted">
              历史时期：<span className="text-ink">{citation.era}</span>
            </div>
          )}
          {citation.series && (
            <div className="mt-0.5 text-xs text-muted">
              所属丛书：<span className="text-ink">{citation.series}</span>
            </div>
          )}
        </div>
        <span className="chip whitespace-nowrap">#{citation.ordinal}</span>
      </div>

      <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink">{body}</div>

      {citation.url && (
        <a
          className="mt-6 inline-flex items-center gap-1 text-sm text-crimson-700 underline-offset-2 hover:underline"
          href={citation.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          原文链接 →
        </a>
      )}
    </article>
  );
}
