"use client";

/** 知识库概览：统计与入口（不含上传）。 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeNav } from "@/components/knowledge/KnowledgeNav";
import { api, type KnowledgeDoc, type KnowledgeStats } from "@/lib/api";

export default function KnowledgeOverviewPage() {
  return (
    <AppShell>
      <KnowledgeOverview />
    </AppShell>
  );
}

function KnowledgeOverview() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, d] = await Promise.all([
          api<KnowledgeStats>("/api/knowledge/stats"),
          api<KnowledgeDoc[]>("/api/knowledge/documents?limit=8"),
        ]);
        setStats(s);
        setDocs(d);
      } catch (e: unknown) {
        setError(String((e as Error)?.message || e));
      }
    })();
  }, []);

  const needsRerun = useMemo(
    () =>
      docs.filter((d) => {
        const r = d.extra_metadata?.review as { needs_rerun?: boolean } | undefined;
        return Boolean(r?.needs_rerun);
      }).length,
    [docs]
  );

  return (
    <div className="space-y-6">
      <KnowledgeNav />
      <header className="panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-crimson-800">知识库概览</h1>
            <p className="mt-1 text-sm text-muted">
              浏览文献与图谱；上传与 VL 重跑请到「构建」页。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/knowledge/documents" className="btn-outline">
              文献列表
            </Link>
            <Link href="/knowledge/build" className="btn-primary">
              去构建
            </Link>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-crimson-700">{error}</p> : null}
        {stats ? (
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard label="入库文档" value={stats.indexed_documents} />
            <StatCard label="父块总数" value={stats.total_chunks} />
            <StatCard label="待处理" value={stats.pending_documents} />
            <StatCard label="失败" value={stats.failed_documents} tone="warn" />
            <StatCard label="近期需重跑" value={needsRerun} tone="warn" />
          </div>
        ) : null}
        {stats ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <BreakdownCard
              title="按历史时期"
              items={stats.by_era.map((b) => ({ label: b.era, value: b.count }))}
            />
            <BreakdownCard
              title="按丛书系列"
              items={stats.by_series.map((b) => ({ label: b.series, value: b.count }))}
            />
          </div>
        ) : null}
      </header>

      <section className="panel p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-crimson-800">近期文档</h2>
          <Link href="/knowledge/documents" className="text-xs text-crimson-700 hover:underline">
            查看全部
          </Link>
        </div>
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <Link href={`/knowledge/documents/${d.id}`} className="truncate font-medium text-ink hover:text-crimson-800">
                {d.title}
              </Link>
              <span className="shrink-0 text-xs text-muted">{d.status}</span>
            </li>
          ))}
          {!docs.length ? <li className="py-4 text-sm text-muted">暂无文档</li> : null}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-crimson-700" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function BreakdownCard({ title, items }: { title: string; items: { label: string; value: number }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wider text-muted">{title}</div>
      <ul className="mt-2 space-y-1.5">
        {items.length === 0 && <li className="text-sm text-muted">—</li>}
        {items.map((i) => {
          const pct = total ? Math.round((i.value / total) * 100) : 0;
          return (
            <li key={i.label} className="text-sm">
              <div className="flex justify-between">
                <span className="text-ink">{i.label}</span>
                <span className="text-muted">
                  {i.value} · {pct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
                <div className="h-full bg-crimson-500" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
