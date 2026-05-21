"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { CitationDetailView } from "@/components/citations/CitationDetailView";
import { api, type Citation } from "@/lib/api";

export default function CitationPage() {
  return (
    <AppShell>
      <CitationDetail />
    </AppShell>
  );
}

function CitationDetail() {
  const params = useParams<{ id: string; mid: string; cid: string }>();
  const [citation, setCitation] = useState<Citation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { id, mid, cid } = params;
    api<Citation>(`/api/threads/${id}/messages/${mid}/citations/${cid}`)
      .then(setCitation)
      .catch((e) => setError(String(e.message || e)));
  }, [params]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href={`/?thread=${params.id}`} className="btn-ghost">
          ← 返回对话
        </Link>
      </div>
      {error && <div className="panel p-6 text-crimson-800">无法加载引用：{error}</div>}
      {!citation && !error && <div className="panel p-6 text-muted">正在加载引用…</div>}
      {citation && <CitationDetailView citation={citation} />}
    </div>
  );
}
