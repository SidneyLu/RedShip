export type CitationHrefContext =
  | {
      kind: 'run';
      href: string;
      runId: string;
      citationId: string;
    }
  | {
      kind: 'message';
      href: string;
      threadId: string;
      messageId: string;
      citationId: string;
    };

function normalizeHref(href: string): string {
  if (!href) return '';
  try {
    const url = href.startsWith('http://') || href.startsWith('https://') ? new URL(href) : new URL(href, 'http://local');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function parseCitationHref(href: string): CitationHrefContext | null {
  const normalized = normalizeHref(href).replace(/\/+$/, '');
  let match = normalized.match(/^\/research\/([^/]+)\/citations\/([^/?#]+)$/);
  if (match) {
    return {
      kind: 'run',
      href: normalized,
      runId: decodeURIComponent(match[1]),
      citationId: decodeURIComponent(match[2]),
    };
  }

  match = normalized.match(/^\/threads\/([^/]+)\/messages\/([^/]+)\/citations\/([^/?#]+)$/);
  if (match) {
    return {
      kind: 'message',
      href: normalized,
      threadId: decodeURIComponent(match[1]),
      messageId: decodeURIComponent(match[2]),
      citationId: decodeURIComponent(match[3]),
    };
  }

  return null;
}
