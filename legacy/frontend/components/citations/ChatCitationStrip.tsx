'use client';

import type { CitationItem } from '@/lib/api';
import { CitationChip } from '@/components/citations/CitationChip';

interface ChatCitationStripProps {
  threadId: string;
  messageId: string;
  citations: CitationItem[];
}

function isLocalCitation(item: CitationItem): boolean {
  if (item.preview_ref) {
    return item.preview_ref.previewable && item.preview_ref.source_kind !== 'web';
  }
  return item.source_type === 'base' || item.source_type === 'upload';
}

export function ChatCitationStrip({ threadId, messageId, citations }: ChatCitationStripProps) {
  const localCitations = citations.filter(isLocalCitation);

  if (localCitations.length === 0) {
    return null;
  }

  return (
    <div className='mt-3 flex flex-wrap gap-2'>
      {localCitations.map((item, index) => (
        <CitationChip
          key={item.citation_id}
          href={`/threads/${threadId}/messages/${messageId}/citations/${item.citation_id}`}
        >
          {`[${index + 1}] ${item.title}`}
        </CitationChip>
      ))}
    </div>
  );
}
