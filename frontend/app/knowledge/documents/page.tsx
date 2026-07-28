"use client";

/** 文献列表（无上传）。 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeNav } from "@/components/knowledge/KnowledgeNav";
import { KnowledgeList } from "@/components/knowledge/KnowledgeList";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { api, type KnowledgeDoc } from "@/lib/api";

export default function KnowledgeDocumentsPage() {
  return (
    <AppShell>
      <DocumentsView />
    </AppShell>
  );
}

function DocumentsView() {
  const { user } = useAuth();
  const { show } = useToast();
  const router = useRouter();
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
      const d = await api<KnowledgeDoc[]>(
        `/api/knowledge/documents?` +
          new URLSearchParams({
            ...(q ? { q } : {}),
            ...(era ? { era } : {}),
            ...(series ? { series } : {}),
            ...(status ? { status } : {}),
            limit: "200",
          }).toString()
      );
      setDocs(d);
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
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
    } catch (e: unknown) {
      show({
        title: "删除失败",
        description: String((e as Error)?.message || e),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <KnowledgeNav />
      <section className="panel p-6">
        <h1 className="text-xl font-semibold text-crimson-800">文献库</h1>
        <div className="mt-4 flex flex-wrap items-end gap-3">
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
            onOpen={(doc) => router.push(`/knowledge/documents/${doc.id}`)}
          />
        </div>
      </section>
    </div>
  );
}
