"use client";

/** 管理页：文献增量同步、全量重建索引（管理员）。 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { api, getApiBase, getToken, type KnowledgeStats } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";
import { useAuth } from "@/components/providers/AuthProvider";

export default function AdminPage() {
  return (
    <AppShell>
      <AdminInner />
    </AppShell>
  );
}

interface ProgressEvent {
  type: string;
  current?: number;
  total?: number;
  path?: string;
  outcome?: string;
  message?: string;
}

function AdminInner() {
  const { user } = useAuth();
  const { show } = useToast();
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [running, setRunning] = useState(false);

  const refresh = async () => {
    try {
      const s = await api<KnowledgeStats>("/api/knowledge/stats");
      setStats(s);
    } catch {}
  };

  useEffect(() => {
    refresh();
  }, []);

  if (!user?.is_admin) {
    return (
      <div className="panel p-8 text-center">
        <h1 className="text-2xl font-semibold text-crimson-800">需要管理员权限</h1>
        <p className="mt-2 text-sm text-muted">
          只有 <code>is_admin=true</code> 的账户才能访问此页面。请联系系统管理员。
        </p>
        <Link href="/" className="btn-primary mt-4 inline-flex">
          返回对话
        </Link>
      </div>
    );
  }

  const runSync = async () => {
    setEvents([]);
    setRunning(true);

    try {
      const url = `${getApiBase()}/api/admin/bibliography/sync/stream`;
      const resp = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${getToken() || ""}`, Accept: "text/event-stream" },
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (!dataLines.length) continue;
          try {
            const payload = JSON.parse(dataLines.join("\n"));
            setEvents((cur) => [...cur, payload]);
          } catch {}
        }
      }
      show({ title: "同步完成", variant: "success" });
      refresh();
    } catch (e: any) {
      show({ title: "同步失败", description: String(e.message), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="panel flex items-center justify-between p-6">
        <div>
          <h1 className="text-2xl font-semibold text-crimson-800">管理控制台</h1>
          <p className="mt-1 text-sm text-muted">
            触发 <code>bibliography/</code> 增量同步，向新文档建立索引。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={running} onClick={runSync}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {running ? "同步中…" : "增量同步"}
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              await api("/api/admin/bibliography/reindex", { method: "POST" });
              show({ title: "全量重建完成", variant: "success" });
              refresh();
            } catch (e: any) {
              show({ title: "重建失败", description: String(e.message), variant: "destructive" });
            } finally {
              setRunning(false);
            }
          }}
        >
          全量重建
        </button>
        </div>
      </header>

      {stats && (
        <section className="panel grid grid-cols-2 gap-4 p-6 md:grid-cols-4">
          <Stat title="入库文档" value={stats.indexed_documents} />
          <Stat title="父块总数" value={stats.total_chunks} />
          <Stat title="待处理" value={stats.pending_documents} />
          <Stat title="失败" value={stats.failed_documents} warn />
        </section>
      )}

      <section className="panel p-4">
        <div className="border-b border-border pb-2 text-sm font-semibold text-crimson-800">
          同步进度
        </div>
        <ol className="scroll-pretty mt-2 max-h-[60vh] overflow-y-auto text-sm">
          {events.length === 0 && (
            <li className="px-2 py-4 text-muted">
              点击「立即同步」开始扫描 <code>bibliography/</code>。
            </li>
          )}
          {events.map((e, idx) => (
            <li key={idx} className="border-b border-border/60 px-2 py-1.5">
              <span className="mr-2 inline-block min-w-[5rem] text-xs uppercase tracking-wider text-muted">
                {e.type}
              </span>
              {e.path && <span className="text-ink">{e.path}</span>}
              {e.outcome && <span className="ml-2 text-xs text-crimson-700">{e.outcome}</span>}
              {e.message && <span className="ml-2 text-xs text-crimson-700">{e.message}</span>}
              {e.current !== undefined && e.total !== undefined && (
                <span className="ml-2 text-xs text-muted">
                  {e.current}/{e.total}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Stat({ title, value, warn }: { title: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wider text-muted">{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${warn ? "text-crimson-700" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
