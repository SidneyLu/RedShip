"use client";

/** 引用详情路由页：/threads/:id/messages/:mid/citations/:cid */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { CitationDetailView } from "@/components/citations/CitationDetailView";
import {
  api,
  getThreadMessageCitationPreview,
  type Citation,
  type CitationPreviewPage,
} from "@/lib/api";

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
  const [preview, setPreview] = useState<CitationPreviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { id, mid, cid } = params;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCitation(null);
    setPreview(null);

    getThreadMessageCitationPreview(id, mid, cid, "page")
      .then((next) => {
        if (!cancelled) setPreview(next as CitationPreviewPage);
      })
      .catch(async () => {
        try {
          const fallback = await api<Citation>(`/api/threads/${id}/messages/${mid}/citations/${cid}`);
          if (!cancelled) setCitation(fallback);
        } catch (e: any) {
          if (!cancelled) setError(String(e.message || e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href={`/?thread=${params.id}`} className="btn-ghost">
          ← 返回对话
        </Link>
      </div>
      {error && <div className="panel p-6 text-crimson-800">无法加载引用：{error}</div>}
      {loading && !error && <div className="panel p-6 text-muted">正在加载引用…</div>}
      {!loading && !error && <CitationDetailView citation={citation} preview={preview} />}
    </div>
  );
}
