"use client";

/** 对话侧实时 ego-graph：随分析实体与引用动态展开。 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Network, X } from "lucide-react";
import { KnowledgeGraphView } from "@/components/knowledge/KnowledgeGraphView";
import { api, type GraphPayload } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  names: string[];
  docIds: string[];
  onClose?: () => void;
  className?: string;
  variant?: "panel" | "drawer";
}

export function ChatKnowledgeGraph({
  names,
  docIds,
  onClose,
  className,
  variant = "panel",
}: Props) {
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

  const body = (
    <>
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-crimson-700">
            <Network className="h-3 w-3" />
            相关知识子图
            {loading ? " · 更新中" : ""}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-ink">
            {names.length || docIds.length
              ? `${names.slice(0, 3).join(" · ") || "文献"}${names.length > 3 ? "…" : ""}`
              : "提问后显示"}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/knowledge/graph" className="rounded-lg px-2 py-1 text-[10px] text-muted hover:bg-crimson-50 hover:text-crimson-800">
            全图
          </Link>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-crimson-50 hover:text-crimson-800"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="p-4 text-sm text-crimson-700">{error}</div>
      ) : (
        <div className={cn(variant === "panel" && "min-h-0 flex-1")}>
          <KnowledgeGraphView
            compact
            data={data}
            height={variant === "drawer" ? 360 : "100%"}
            emptyHint="提问后显示相关知识子图（人物、机构、引用文献）"
            className={variant === "panel" ? "h-full border-0 shadow-none" : undefined}
          />
        </div>
      )}
    </>
  );

  if (variant === "drawer") {
    return (
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-hidden rounded-t-2xl border border-border bg-card shadow-soft lg:hidden",
          className
        )}
      >
        {body}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft",
        className
      )}
    >
      {body}
    </aside>
  );
}
