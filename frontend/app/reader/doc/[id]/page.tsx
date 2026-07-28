"use client";

import { Suspense, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeNav } from "@/components/knowledge/KnowledgeNav";
import { PdfReader, type PdfRect } from "@/components/reader/PdfReader";

function ReaderInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const docId = params.id;
  const page = Number(search.get("page") || "1") || 1;
  const highlight = search.get("q");
  const rects = useMemo(() => {
    const raw = search.get("rects");
    if (!raw) return [] as PdfRect[];
    try {
      const parsed = JSON.parse(raw) as PdfRect[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [search]);

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <KnowledgeNav />
      <div className="mb-2 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-crimson-800">原文阅读器</h1>
        <Link href={`/knowledge/documents/${docId}`} className="btn-ghost text-sm">
          ← 文档详情
        </Link>
      </div>
      <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <PdfReader
          documentId={docId}
          page={page}
          rects={rects}
          highlightText={highlight}
        />
      </div>
    </div>
  );
}

export default function DocumentReaderPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-6 text-sm text-muted">加载阅读器…</div>}>
        <ReaderInner />
      </Suspense>
    </AppShell>
  );
}
