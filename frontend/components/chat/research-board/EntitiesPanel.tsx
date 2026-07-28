"use client";

/** Compact ego graph embed for the research board (no outer chrome drawer). */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { KnowledgeGraphView } from "@/components/knowledge/KnowledgeGraphView";
import { api, type GraphPayload } from "@/lib/api";

interface Props {
  names: string[];
  docIds: string[];
}

export function EntitiesPanel({ names, docIds }: Props) {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestKey = useMemo(() => {
    const n = [...names].map((s) => s.trim()).filter(Boolean).sort();
    const d = [...docIds].map((s) => s.trim()).filter(Boolean).sort();
    return JSON.stringify({ n, d });
  }, [names, docIds]);

  useEffect(() => {
    const parsed = JSON.parse(requestKey) as { n: string[]; d: string[] };
    if (!parsed.n.length && !parsed.d.length) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (parsed.n.length) params.set("names", parsed.n.join(","));
        if (parsed.d.length) params.set("doc_ids", parsed.d.join(","));
        params.set("depth", "1");
        params.set("limit", "80");
        const res = await api<GraphPayload>(`/api/knowledge/graph/ego?${params.toString()}`);
        setData(res);
      } catch (e: unknown) {
        setError(String((e as Error)?.message || e));
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [requestKey]);

  if (!names.length && !docIds.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
        <p>暂无实体种子</p>
        <p className="text-xs">引用文献或分析实体出现后，将在此展开相关知识子图。</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[11px] text-muted">
          {loading ? "更新中…" : data ? `${data.nodes?.length || 0} 节点` : "—"}
          {error ? ` · ${error}` : ""}
        </p>
        <Link
          href="/knowledge/graph"
          className="text-[11px] text-crimson-700 hover:underline"
        >
          打开全图
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        {data ? (
          <KnowledgeGraphView data={data} className="h-full min-h-[280px]" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {loading ? "加载子图…" : "无图数据"}
          </div>
        )}
      </div>
    </div>
  );
}
