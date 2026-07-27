/**
 * Citation display helpers: keep stable ids (k-1, c-1) in hrefs,
 * but always show ordinal chips like (1) to match the bottom strip.
 */

import type { Citation } from "@/lib/api";

/** Backend generator citation href pattern */
export const CITATION_HREF_RE =
  /^\/threads\/[^/]+\/messages\/[^/]+\/citations\/([^/]+)$/i;

/**
 * Visible markers the model may emit — including mistaken id forms like (k-1).
 * Examples: (1), (k-3), #2, [c-1], k-1
 */
export const CITATION_LABEL_RE =
  /^\s*(?:\((?:[a-z]-)?\d+\)|#(?:[a-z]-)?\d+|\[(?:[a-z]-)?\d+\]|(?:[a-z]-)\d+)\s*$/i;

export function findCitation(
  citations: Citation[] | null | undefined,
  id: string
): Citation | undefined {
  if (!citations) return undefined;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    /* keep raw */
  }
  return (
    citations.find((c) => String(c.id) === id || String(c.id) === decoded) ||
    citations.find((c) => String(c.ordinal) === id || String(c.ordinal) === decoded) ||
    undefined
  );
}

/** Chip / inline label: always (ordinal), never k-/c-/r- prefixes. */
export function citationChipLabel(citation: Citation | undefined, rawLabel: string): string {
  if (citation?.ordinal != null && Number(citation.ordinal) > 0) {
    return `(${citation.ordinal})`;
  }
  const m = /^\s*[\[#()]?(?:[a-z]-)?(\d+)[\]#)]?\s*$/i.exec(String(rawLabel || "").trim());
  if (m?.[1]) return `(${m[1]})`;
  return rawLabel;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function citationPath(threadId: string, messageId: string, citationId: string): string {
  return `/threads/${threadId}/messages/${messageId}/citations/${encodeURIComponent(citationId)}`;
}

/**
 * Rewrite markdown so citation link text and bare markers become ordinal chips.
 * Hrefs keep citation ids for routing / preview.
 */
export function normalizeCitationMarkdown(
  content: string,
  citations?: Citation[] | null,
  opts?: { threadId?: string | null; messageId?: string | null }
): string {
  if (!content) return content;

  let out = content.replace(
    /\[([^\]]*)\]\((\/threads\/[^/]+\/messages\/[^/]+\/citations\/([^)\s]+))\)/gi,
    (_full, label: string, path: string, id: string) => {
      const citation = findCitation(citations, id);
      // Always normalize known citation links to (ordinal) chip labels (chat + research).
      return `[${citationChipLabel(citation, String(label || ""))}](${path})`;
    }
  );

  if (citations?.length) {
    const byIdLen = [...citations].sort(
      (a, b) => String(b.id).length - String(a.id).length
    );
    for (const c of byIdLen) {
      const id = String(c.id || "");
      if (!/^[a-z]+-\d+$/i.test(id)) continue;
      const re = new RegExp(`\\(${escapeRegExp(id)}\\)`, "g");
      out = out.replace(re, `(${c.ordinal})`);
    }

    const tid = opts?.threadId?.trim();
    const mid = opts?.messageId?.trim();
    if (tid && mid) {
      // Bare (1)/(2) → linked chips (same as research inline style).
      // Skip markers already inside markdown links: [(1)](...)
      const byOrdinal = [...citations]
        .filter((c) => c.ordinal != null && Number(c.ordinal) > 0)
        .sort((a, b) => Number(b.ordinal) - Number(a.ordinal));
      for (const c of byOrdinal) {
        const path = citationPath(tid, mid, String(c.id));
        const re = new RegExp(
          `(?<!\\[)\\(${escapeRegExp(String(c.ordinal))}\\)(?!\\]\\()`,
          "g"
        );
        out = out.replace(re, `[(${c.ordinal})](${path})`);
      }
    }
  }

  return out;
}
