"use client";

/** 行内引用角标；悬停可触发 CitationPreviewProvider。 */

import { useCallback } from "react";
import { useCitationPreview } from "./CitationPreviewProvider";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/api";

interface Props {
  label: string;
  citation: Citation | undefined;
  variant?: "report-inline" | "list";
  onClick?: (citation: Citation) => void;
}

export function CitationChip({ label, citation, variant = "report-inline", onClick }: Props) {
  const { showPreview, hidePreview } = useCitationPreview();

  const handleEnter = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!citation) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      showPreview(citation, rect);
    },
    [citation, showPreview]
  );

  const handleLeave = useCallback(() => hidePreview(), [hidePreview]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (citation && onClick) {
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

  return (
    <a
      href={citation.url || "#"}
      target={citation.url ? "_blank" : undefined}
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
