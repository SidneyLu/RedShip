import { CitationDetailView } from '@/components/citations/CitationDetailView';

export default async function ResearchCitationDetailPage({
  params,
}: {
  params: Promise<{ runId: string; citationId: string }>;
}) {
  const { runId, citationId } = await params;
  return <CitationDetailView context={{ kind: 'run', runId, citationId }} />;
}
