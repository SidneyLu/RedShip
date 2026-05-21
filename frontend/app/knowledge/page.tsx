"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { DocumentUploader } from "@/components/knowledge/DocumentUploader";
import { KnowledgeList } from "@/components/knowledge/KnowledgeList";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { api, type KnowledgeDoc, type KnowledgeStats } from "@/lib/api";

export default function KnowledgePage() {
  return (
    <AppShell>
      <KnowledgeView />
    </AppShell>
  );
}

function KnowledgeView() {
  const { user } = useAuth();
  const { show } = useToast();
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [q, setQ] = useState("");
  const [era, setEra] = useState("");
  const [series, setSeries] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        api<KnowledgeStats>("/api/knowledge/stats"),
        api<KnowledgeDoc[]>(
          `/api/knowledge/documents?` +
            new URLSearchParams({
              ...(q ? { q } : {}),
              ...(era ? { era } : {}),
              ...(series ? { series } : {}),
              ...(status ? { status } : {}),
              limit: "200",
            }).toString()
        ),
      ]);
      setStats(s);
      setDocs(d);
      setError(null);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (doc: KnowledgeDoc) => {
    if (!confirm(`确定删除「${doc.title}」？`)) return;
    try {
      await api(`/api/knowledge/documents/${doc.id}`, { method: "DELETE" });
      show({ title: "已删除", variant: "success" });
      reload();
    } catch (e: any) {
      show({ title: "删除失败", description: String(e.message || e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <header className="panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-crimson-800">知识库总览</h1>
            <p className="mt-1 text-sm text-muted">
              所有在 <code>bibliography/</code> 中的文献都将按 SHA-256 增量入库，并以混合检索（ANN + BM25）+ 重排提供证据。
            </p>
          </div>
          <Link href="/" className="btn-ghost">
            ← 返回对话
          </Link>
        </div>
        {stats && (
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="入库文档" value={stats.indexed_documents} />
            <StatCard label="父块总数" value={stats.total_chunks} />
            <StatCard label="待处理" value={stats.pending_documents} />
            <StatCard label="失败" value={stats.failed_documents} tone="warn" />
          </div>
        )}
        {stats && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <BreakdownCard title="按历史时期" items={stats.by_era.map((b) => ({ label: b.era, value: b.count }))} />
            <BreakdownCard title="按丛书系列" items={stats.by_series.map((b) => ({ label: b.series, value: b.count }))} />
          </div>
        )}
      </header>

      {user?.is_admin && (
        <section className="panel p-6">
          <h2 className="text-sm font-semibold text-crimson-800">上传文档</h2>
          <div className="mt-3">
            <DocumentUploader onUploaded={reload} />
          </div>
        </section>
      )}

      <section className="panel p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label">关键字</label>
            <input
              className="input mt-1"
              placeholder="标题 / 路径"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <label className="label">历史时期</label>
            <input className="input mt-1" value={era} onChange={(e) => setEra(e.target.value)} />
          </div>
          <div>
            <label className="label">丛书</label>
            <input className="input mt-1" value={series} onChange={(e) => setSeries(e.target.value)} />
          </div>
          <div>
            <label className="label">状态</label>
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部</option>
              <option value="indexed">已索引</option>
              <option value="parsing">解析中</option>
              <option value="pending">待处理</option>
              <option value="failed">失败</option>
            </select>
          </div>
          <button type="button" className="btn-primary" onClick={reload}>
            筛选
          </button>
        </div>

        <div className="mt-4">
          <KnowledgeList
            docs={docs}
            loading={loading}
            error={error}
            canDelete={!!user?.is_admin}
            onDelete={handleDelete}
          />
        </div>
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
