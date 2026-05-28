import { ResearchRunDetail } from '@/components/ResearchRunDetail';

export default async function ResearchRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <ResearchRunDetail runId={runId} />;
}
