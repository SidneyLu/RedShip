"use client";

/** 力导向知识图谱视图：按类型着色，点击节点显示侧栏详情。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2, Network, RefreshCw } from "lucide-react";
import { api, type GraphEdge, type GraphNode, type GraphPayload } from "@/lib/api";
import { cn } from "@/lib/utils";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const TYPE_COLORS: Record<string, string> = {
  era: "#9f1239",
  series: "#be123c",
  document: "#1e3a5f",
  section: "#64748b",
  person: "#b45309",
  organization: "#0f766e",
  event: "#7c3aed",
};

type FgNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
type FgLink = GraphEdge & { source: string | FgNode; target: string | FgNode };

interface Props {
  className?: string;
  height?: number | string;
  compact?: boolean;
  /** 外部传入数据时不自行拉取 */
  data?: GraphPayload | null;
  /** 浏览页过滤 */
  era?: string;
  series?: string;
  q?: string;
  types?: string;
  limitNodes?: number;
  /** 拉取完成或刷新时回调 */
  onLoaded?: (data: GraphPayload) => void;
  refreshKey?: number | string;
  emptyHint?: string;
}

export function KnowledgeGraphView({
  className,
  height = 560,
  compact = false,
  data: externalData,
  era,
  series,
  q,
  types,
  limitNodes = 200,
  onLoaded,
  refreshKey,
  emptyHint = "暂无图谱数据。请先入库文献或在管理页重建图谱。",
}: Props) {
  const controlled = externalData !== undefined;
  const [payload, setPayload] = useState<GraphPayload | null>(externalData ?? null);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const fgRef = useRef<{ zoomToFit?: (ms?: number, px?: number) => void } | null>(null);

  const load = useCallback(async () => {
    if (controlled) {
      setPayload(externalData ?? null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (era) params.set("era", era);
      if (series) params.set("series", series);
      if (q) params.set("q", q);
      if (types) params.set("types", types);
      params.set("limit_nodes", String(limitNodes));
      const res = await api<GraphPayload>(`/api/knowledge/graph?${params.toString()}`);
      setPayload(res);
      onLoaded?.(res);
    } catch (e: unknown) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [controlled, externalData, era, series, q, types, limitNodes, onLoaded]);

  useEffect(() => {
    if (controlled) {
      setPayload(externalData ?? null);
      setLoading(false);
      return;
    }
    void load();
  }, [controlled, externalData, load, refreshKey]);

  const graphData = useMemo(() => {
    if (!payload) return { nodes: [] as FgNode[], links: [] as FgLink[] };
    return {
      nodes: payload.nodes.map((n) => ({ ...n })),
      links: payload.edges.map((e) => ({ ...e })),
    };
  }, [payload]);

  useEffect(() => {
    if (!payload?.nodes.length) return;
    const t = window.setTimeout(() => {
      fgRef.current?.zoomToFit?.(400, 40);
    }, 300);
    return () => window.clearTimeout(t);
  }, [payload]);

  const paintNode = useCallback((node: FgNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label || "";
    const r = Math.max(3, Math.min(14, (node.size || 2) * 1.4));
    const color = TYPE_COLORS[node.type] || "#475569";
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();
    if (node.seed) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }
    if (globalScale > 0.7 && label) {
      const fontSize = Math.max(10 / globalScale, 2.5);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#1a1a1a";
      const short = label.length > 12 ? `${label.slice(0, 12)}…` : label;
      ctx.fillText(short, node.x || 0, (node.y || 0) + r + 1);
    }
  }, []);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-crimson-800">
            <Network className="h-4 w-4" />
            知识图谱
            {payload ? (
              <span className="text-xs font-normal text-muted">
                {payload.nodes.length} 节点 · {payload.edges.length} 边
              </span>
            ) : null}
          </div>
          {!externalData && !controlled && (
            <button type="button" className="btn-ghost text-xs" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </button>
          )}
        </div>
      )}

      <div className="relative flex" style={{ height }}>
        <div className={cn("min-w-0 flex-1", selected && !compact ? "md:w-2/3" : "w-full")}>
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/70 text-sm text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载图谱…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-crimson-700">
              {error}
            </div>
          )}
          {!loading && !error && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-muted">
              {emptyHint}
            </div>
          )}
          {graphData.nodes.length > 0 && (
            <ForceGraph2D
              ref={fgRef as never}
              graphData={graphData}
              nodeId="id"
              linkSource="source"
              linkTarget="target"
              backgroundColor="rgba(0,0,0,0)"
              nodeCanvasObject={paintNode as never}
              nodePointerAreaPaint={((node: FgNode, color: string, ctx: CanvasRenderingContext2D) => {
                const r = Math.max(4, Math.min(16, (node.size || 2) * 1.6));
                ctx.beginPath();
                ctx.arc(node.x || 0, node.y || 0, r, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.fill();
              }) as never}
              linkColor={() => "rgba(148, 163, 184, 0.55)"}
              linkWidth={((l: FgLink) => Math.max(0.5, Number(l.weight || 1) * 0.6)) as never}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              onNodeClick={((node: FgNode) => setSelected(node)) as never}
              cooldownTicks={80}
            />
          )}
        </div>

        {selected && !compact && (
          <aside className="w-full shrink-0 border-t border-border p-4 md:w-72 md:border-l md:border-t-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{selected.type}</p>
                <h3 className="mt-1 text-sm font-semibold text-ink">{selected.label}</h3>
              </div>
              <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(null)}>
                关闭
              </button>
            </div>
            {selected.metadata && Object.keys(selected.metadata).length > 0 && (
              <dl className="mt-3 space-y-1 text-xs text-muted">
                {Object.entries(selected.metadata).slice(0, 8).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt>{k}</dt>
                    <dd className="truncate text-ink">{formatMeta(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {selected.type === "document" && Boolean(selected.metadata?.document_id) && (
              <Link
                href="/knowledge"
                className="btn-outline mt-4 inline-flex text-xs"
              >
                查看知识库
              </Link>
            )}
            {selected.type === "document" && (
              <Link href={`/knowledge?q=${encodeURIComponent(selected.label)}`} className="mt-3 block text-xs text-crimson-700 hover:underline">
                在知识库中搜索此文献
              </Link>
            )}
            <Legend className="mt-4" />
          </aside>
        )}
      </div>

      {compact && <Legend className="border-t border-border px-3 py-2" />}
    </div>
  );
}

function Legend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-2 text-[10px] text-muted", className)}>
      {Object.entries(TYPE_COLORS).map(([type, color]) => (
        <li key={type} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          {type}
        </li>
      ))}
    </ul>
  );
}

function formatMeta(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
