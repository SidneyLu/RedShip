"use client";

/** 行内引用角标；悬停可触发 CitationPreviewProvider。 */

import { useCallback } from "react";
import { useCitationPreview } from "./CitationPreviewProvider";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/api";

interface Props {
  label: string;
  citation: Citation | undefined;
  href?: string;
  variant?: "report-inline" | "list";
  onClick?: (citation: Citation) => void;
}

export function CitationChip({ label, citation, href, variant = "report-inline", onClick }: Props) {
  const { schedulePreview, scheduleClose } = useCitationPreview();

  const handleEnter = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!citation) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      schedulePreview(citation, href || "#", rect);
    },
    [citation, href, schedulePreview]
  );

  const handleLeave = useCallback(() => scheduleClose(), [scheduleClose]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (citation && onClick) {
        // 有站内详情（含网页阅读器）时优先进详情页
        e.preventDefault();
        onClick(citation);
      }
    },
    [citation, onClick]
  );

  if (!citation) {
    return (
      <span
        className={cn(
          "citation-chip",
          variant === "list" ? "h-6 min-w-[1.75rem] text-xs" : ""
        )}
      >
        {label}
      </span>
    );
  }

  const isWeb = citation.source_type === "web";
  const resolvedHref = href || (isWeb ? citation.url || "#" : "#");

  return (
    <a
      href={resolvedHref}
      target={isWeb && !onClick && citation.url ? "_blank" : undefined}
      rel="noreferrer noopener"
      className={cn(
        "citation-chip cursor-pointer",
        isWeb ? "web" : "kb",
        variant === "list" ? "h-6 min-w-[1.75rem] text-xs" : ""
      )}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter as any}
      onBlur={handleLeave as any}
      onClick={handleClick}
    >
      {label}
    </a>
  );
}
