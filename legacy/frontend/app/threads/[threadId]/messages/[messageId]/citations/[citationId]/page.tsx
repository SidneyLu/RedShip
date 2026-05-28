import { CitationDetailView } from '@/components/citations/CitationDetailView';

export default async function ThreadCitationDetailPage({
  params,
}: {
  params: Promise<{ threadId: string; messageId: string; citationId: string }>;
}) {
  const { threadId, messageId, citationId } = await params;
  return <CitationDetailView context={{ kind: 'message', threadId, messageId, citationId }} />;
}
