"use client";

/**
 * 渲染助手 Markdown；将内嵌引用链接转为 CitationChip。
 * 链接格式：/threads/{tid}/messages/{mid}/citations/{id}，标签为 (N) / [N] / #N。
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip } from "@/components/citations/CitationChip";
import type { Citation } from "@/lib/api";
import { cn } from "@/lib/utils";

/** 后端 generator 写入的引用 href 模式 */
const CITATION_HREF_RE = /^\/threads\/[^/]+\/messages\/[^/]+\/citations\/([^/]+)$/i;
/** 仅当链接文字为序号标签时才替换为 chip */
const LABEL_RE = /^\s*(?:\(\d+\)|#\d+|\[\d+\])\s*$/;

function findCitation(citations: Citation[] | null | undefined, id: string): Citation | undefined {
  if (!citations) return undefined;
  return (
    citations.find((c) => String(c.id) === id) ||
    citations.find((c) => String(c.ordinal) === id) ||
    undefined
  );
}

export function MarkdownMessage({
  content,
  citations,
  onCitationClick,
  className,
}: {
  content: string;
  citations?: Citation[] | null;
  onCitationClick?: (citation: Citation) => void;
  className?: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn("report-markdown", className)}
      components={{
        a({ href, children, ...rest }) {
          const hrefStr = String(href || "");
          const match = CITATION_HREF_RE.exec(hrefStr);
          const childText =
            (Array.isArray(children) ? children.join("") : String(children || "")).trim();
          if (match && childText && LABEL_RE.test(childText)) {
            const citationId = match[1];
            const citation = findCitation(citations, citationId);
            return (
              <CitationChip
                label={childText}
                citation={citation}
                onClick={onCitationClick}
                variant="report-inline"
              />
            );
          }
          return (
            <a
              {...rest}
              href={hrefStr}
              target={hrefStr.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer noopener"
              className="report-link"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
