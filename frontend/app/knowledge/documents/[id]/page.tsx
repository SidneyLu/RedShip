"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeNav } from "@/components/knowledge/KnowledgeNav";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/providers/ToastProvider";
import {
  api,
  getKnowledgeDocumentSource,
  type KnowledgeDoc,
  type KnowledgeDocumentSource,
} from "@/lib/api";

export default function KnowledgeDocumentDetailPage() {
  return (
    <AppShell>
      <DetailView />
    </AppShell>
  );
}

function DetailView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { show } = useToast();
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null);
  const [source, setSource] = useState<KnowledgeDocumentSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<KnowledgeDoc>(`/api/knowledge/documents/${id}`);
        setDoc(d);
        try {
          setSource(await getKnowledgeDocumentSource(id));
        } catch {
          setSource({ available: false, document_id: id });
        }
      } catch (e: unknown) {
        setError(String((e as Error)?.message || e));
      }
    })();
  }, [id]);

  const review = (doc?.extra_metadata?.review || null) as
    | { score?: number; summary?: string; issues?: string[]; needs_rerun?: boolean }
    | null;
  const parser = String(doc?.extra_metadata?.parser || "—");

  const reparse = async () => {
    if (!user?.is_admin) return;
    setReparsing(true);
    try {
      const updated = await api<KnowledgeDoc>(
        `/api/knowledge/documents/${id}/reparse?parser=vision`,
        { method: "POST" }
      );
      setDoc(updated);
      show({ title: "已重新解析", variant: "success" });
    } catch (e: unknown) {
      show({
        title: "重跑失败",
        description: String((e as Error)?.message || e),
        variant: "destructive",
      });
    } finally {
      setReparsing(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <KnowledgeNav />
        <p className="text-sm text-crimson-700">{error}</p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="space-y-4">
        <KnowledgeNav />
        <p className="text-sm text-muted">加载中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <KnowledgeNav />
      <header className="panel space-y-3 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-crimson-800">{doc.title}</h1>
            <p className="mt-1 text-sm text-muted">{doc.relative_path || doc.id}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {source?.available ? (
              <Link href={`/reader/doc/${doc.id}`} className="btn-primary">
                打开原文阅读器
              </Link>
            ) : null}
            {user?.is_admin ? (
              <button type="button" className="btn-outline" disabled={reparsing} onClick={reparse}>
                {reparsing ? "重跑中…" : "VL 重跑"}
              </button>
            ) : null}
            <Link href="/knowledge/build" className="btn-ghost">
              构建页
            </Link>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Meta label="状态" value={doc.status} />
          <Meta label="来源" value={doc.source} />
          <Meta label="解析器" value={parser} />
          <Meta label="父块" value={String(doc.chunks_count)} />
          <Meta label="时代" value={doc.era || "—"} />
          <Meta label="丛书" value={doc.series || "—"} />
          <Meta label="源 PDF" value={source?.available ? "可用" : "不可用"} />
          <Meta
            label="Review"
            value={
              review?.score != null
                ? `${review.score.toFixed(2)}${review.needs_rerun ? " · 需重跑" : ""}`
                : "—"
            }
          />
        </dl>
        {review?.summary ? <p className="text-sm text-ink">{review.summary}</p> : null}
        {review?.issues?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            {review.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
      </header>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-ink">{value}</dd>
    </div>
  );
}
