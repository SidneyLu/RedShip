"use client";

/** 知识图谱浏览页：过滤 + 力导向图，支持上传/同步后刷新。 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeNav } from "@/components/knowledge/KnowledgeNav";
import { KnowledgeGraphView } from "@/components/knowledge/KnowledgeGraphView";
import { useAuth } from "@/components/providers/AuthProvider";
import { api, type KnowledgeStats } from "@/lib/api";

export default function KnowledgeGraphPage() {
  return (
    <AppShell>
      <GraphPageInner />
    </AppShell>
  );
}

function GraphPageInner() {
  const { user } = useAuth();
  const [era, setEra] = useState("");
  const [series, setSeries] = useState("");
  const [q, setQ] = useState("");
  const [types, setTypes] = useState("");
  const [applied, setApplied] = useState({ era: "", series: "", q: "", types: "" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api<KnowledgeStats>("/api/knowledge/stats"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats, refreshKey]);

  // 同步进行中：若有 pending 文档，每 5s 轮询刷新
  useEffect(() => {
    if (!stats || stats.pending_documents <= 0) return;
    const id = window.setInterval(() => {
      void loadStats();
      bump();
    }, 5000);
    return () => window.clearInterval(id);
  }, [stats?.pending_documents, loadStats, bump]);

  const applyFilters = () => {
    setApplied({ era, series, q, types });
    bump();
  };

  return (
    <div className="space-y-6">
      <KnowledgeNav />
      <header className="panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-crimson-800">知识图谱</h1>
            <p className="mt-1 text-sm text-muted">
              文献结构（时期 · 系列 · 章节）与人物 / 机构 / 事件关系。入库或重建后自动更新。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {user?.is_admin && (
              <Link href="/admin" className="btn-ghost">
                管理 / 重建
              </Link>
            )}
            <Link href="/knowledge/build" className="btn-outline">
              构建上传
            </Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label">关键字</label>
            <input
              className="input mt-1"
              placeholder="文献标题"
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
            <label className="label">类型</label>
            <input
              className="input mt-1"
              placeholder="person,document,…"
              value={types}
              onChange={(e) => setTypes(e.target.value)}
            />
          </div>
          <button type="button" className="btn-primary" onClick={applyFilters}>
            筛选
          </button>
          <button type="button" className="btn-outline" onClick={bump}>
            刷新
          </button>
        </div>

        {stats && stats.pending_documents > 0 && (
          <p className="mt-3 text-xs text-amber-700">
            有 {stats.pending_documents} 篇文档待处理，图谱将每 5 秒自动刷新。
          </p>
        )}
      </header>

      <KnowledgeGraphView
        era={applied.era || undefined}
        series={applied.series || undefined}
        q={applied.q || undefined}
        types={applied.types || undefined}
        refreshKey={refreshKey}
        height={620}
      />
    </div>
  );
}
