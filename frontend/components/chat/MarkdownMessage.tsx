"use client";

/**
 * 渲染助手 Markdown；将内嵌引用链接转为 CitationChip。
 * artifact-html 围栏渲染为「在画布打开」卡片，不在气泡内执行。
 */

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LayoutDashboard } from "lucide-react";
import { CitationChip } from "@/components/citations/CitationChip";
import type { Citation } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ArtifactPart } from "@/lib/chat-types";

/** 后端 generator 写入的引用 href 模式 */
const CITATION_HREF_RE = /^\/threads\/[^/]+\/messages\/[^/]+\/citations\/([^/]+)$/i;
/** 仅当链接文字为序号标签时才替换为 chip */
const LABEL_RE = /^\s*(?:\(\d+\)|#\d+|\[\d+\])\s*$/;

const ARTIFACT_FENCE_RE =
  /```artifact-html\s*\n(?:<!--\s*title:\s*(.+?)\s*-->\s*\n)?([\s\S]*?)```/gi;

function findCitation(citations: Citation[] | null | undefined, id: string): Citation | undefined {
  if (!citations) return undefined;
  return (
    citations.find((c) => String(c.id) === id) ||
    citations.find((c) => String(c.ordinal) === id) ||
    undefined
  );
}

function extractTitleFromCode(code: string, fallback: string): string {
  const m = /<!--\s*title:\s*(.+?)\s*-->/i.exec(code);
  return (m?.[1] || fallback).trim() || fallback;
}

export function MarkdownMessage({
  content,
  citations,
  onCitationClick,
  onOpenArtifact,
  className,
}: {
  content: string;
  citations?: Citation[] | null;
  onCitationClick?: (citation: Citation) => void;
  onOpenArtifact?: (artifact: ArtifactPart) => void;
  className?: string;
}) {
  const { display, placeholders } = useMemo(() => {
    const map = new Map<string, ArtifactPart>();
    let i = 0;
    const displayMd = content.replace(ARTIFACT_FENCE_RE, (_full, titleGroup: string, code: string) => {
      i += 1;
      const id = `md-artifact-${i}`;
      const title = (titleGroup || extractTitleFromCode(code, `可视化 ${i}`)).trim();
      map.set(id, {
        id,
        title,
        language: "html",
        code: code.trim(),
        status: "done",
      });
      return `\n\n[[ARTIFACT:${id}]]\n\n`;
    });
    return { display: displayMd, placeholders: map };
  }, [content]);

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
                href={hrefStr}
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
        p({ children, ...rest }) {
          const flat = Array.isArray(children)
            ? children.map((c) => (typeof c === "string" ? c : "")).join("")
            : typeof children === "string"
              ? children
              : "";
          const m = /\[\[ARTIFACT:([^\]]+)\]\]/.exec(flat);
          if (m) {
            const art = placeholders.get(m[1]);
            if (art) {
              return (
                <button
                  type="button"
                  onClick={() => onOpenArtifact?.(art)}
                  className="my-2 flex w-full items-center gap-2 rounded-xl border border-crimson-200 bg-crimson-50 px-3 py-2.5 text-left text-sm text-crimson-900 hover:bg-crimson-100"
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-medium">在画布打开</span>
                    <span className="mt-0.5 block text-xs text-crimson-700/80">{art.title}</span>
                  </span>
                </button>
              );
            }
          }
          return <p {...rest}>{children}</p>;
        },
        code({ className: codeClass, children, ...rest }) {
          const lang = /language-([\w-]+)/.exec(codeClass || "")?.[1];
          if (lang === "artifact-html") {
            const code = String(children || "").replace(/\n$/, "");
            const art: ArtifactPart = {
              id: `code-${code.slice(0, 12).replace(/\W/g, "")}`,
              title: extractTitleFromCode(code, "可视化"),
              language: "html",
              code,
              status: "done",
            };
            return (
              <button
                type="button"
                onClick={() => onOpenArtifact?.(art)}
                className="my-2 flex w-full items-center gap-2 rounded-xl border border-crimson-200 bg-crimson-50 px-3 py-2.5 text-left text-sm text-crimson-900 hover:bg-crimson-100"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>
                  <span className="font-medium">在画布打开</span>
                  <span className="mt-0.5 block text-xs text-crimson-700/80">{art.title}</span>
                </span>
              </button>
            );
          }
          const isBlock = Boolean(codeClass);
          if (isBlock) {
            return (
              <code className={codeClass} {...rest}>
                {children}
              </code>
            );
          }
          return (
            <code className={codeClass} {...rest}>
              {children}
            </code>
          );
        },
      }}
    >
      {display}
    </ReactMarkdown>
  );
}
