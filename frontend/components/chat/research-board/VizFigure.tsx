"use client";

/** Render structured research figures (ECharts / timeline / network). */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle } from "lucide-react";
import type { VizSpec } from "@/lib/api";
import { cn } from "@/lib/utils";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function timelineToOption(viz: VizSpec): Record<string, unknown> | null {
  const items = Array.isArray(viz.items) ? viz.items : [];
  if (!items.length) return null;
  const categories = items.map((it, i) => String(it.time || it.name || `事件 ${i + 1}`));
  const data = items.map((it, i) => ({
    name: String(it.name || it.title || categories[i]),
    value: i,
    detail: String(it.detail || it.description || ""),
  }));
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: { data?: { name?: string; detail?: string } }) =>
        `${p?.data?.name || ""}${p?.data?.detail ? `<br/>${p.data.detail}` : ""}`,
    },
    grid: { left: 24, right: 24, top: 40, bottom: 40 },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { rotate: categories.length > 5 ? 30 : 0, fontSize: 11 },
    },
    yAxis: { type: "value", show: false, min: -1, max: 1 },
    series: [
      {
        type: "scatter",
        symbolSize: 18,
        data: data.map((d) => [d.value, 0, d]),
        label: {
          show: true,
          formatter: (p: { data?: unknown[] }) => {
            const payload = p?.data?.[2] as { name?: string } | undefined;
            return payload?.name || "";
          },
          position: "top",
          fontSize: 11,
        },
        itemStyle: { color: "#9f1239" },
      },
    ],
  };
}

function networkToOption(viz: VizSpec): Record<string, unknown> | null {
  const nodes = Array.isArray(viz.nodes) ? viz.nodes : [];
  const links = Array.isArray(viz.links) ? viz.links : [];
  if (!nodes.length) return null;
  return {
    tooltip: {},
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        label: { show: true, fontSize: 11 },
        force: { repulsion: 120, edgeLength: 80 },
        data: nodes.map((n, i) => ({
          id: String(n.id ?? i),
          name: String(n.name || n.label || n.id || `节点 ${i + 1}`),
          symbolSize: Number(n.size || 28),
          category: 0,
        })),
        links: links.map((l) => ({
          source: String(l.source ?? l.from ?? ""),
          target: String(l.target ?? l.to ?? ""),
          label: { show: Boolean(l.relation || l.label), formatter: String(l.relation || l.label || "") },
        })),
        lineStyle: { color: "#94a3b8", curveness: 0.1 },
        itemStyle: { color: "#be123c" },
      },
    ],
  };
}

function resolveOption(viz: VizSpec | null | undefined): {
  option: Record<string, unknown> | null;
  error: string | null;
} {
  if (!viz || typeof viz !== "object") {
    return { option: null, error: "缺少可视化规格" };
  }
  const kind = viz.kind || "echarts";
  try {
    if (kind === "echarts") {
      if (!viz.option || typeof viz.option !== "object") {
        return { option: null, error: "ECharts 缺少 option" };
      }
      return { option: viz.option, error: null };
    }
    if (kind === "timeline") {
      const option = timelineToOption(viz);
      return option
        ? { option, error: null }
        : { option: null, error: "时间线缺少 items" };
    }
    if (kind === "network") {
      const option = networkToOption(viz);
      return option
        ? { option, error: null }
        : { option: null, error: "关系网缺少 nodes" };
    }
    return { option: null, error: `不支持的 kind: ${kind}` };
  } catch (e) {
    return { option: null, error: String((e as Error)?.message || e) };
  }
}

interface Props {
  viz?: VizSpec | null;
  title?: string;
  className?: string;
  height?: number;
}

export function VizFigure({ viz, title, className, height = 320 }: Props) {
  const { option, error } = useMemo(() => resolveOption(viz), [viz]);
  const heading = title || viz?.title || "附图";

  if (error || !option) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-canvas/40 p-6 text-center text-sm text-muted",
          className
        )}
      >
        <AlertTriangle className="h-5 w-5 text-crimson-600" />
        <p className="font-medium text-ink">{heading}</p>
        <p>{error || "无法渲染附图"}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-white p-2", className)}>
      <p className="px-2 pb-1 text-xs font-semibold text-ink">{heading}</p>
      <ReactECharts
        option={option}
        style={{ height, width: "100%" }}
        notMerge
        lazyUpdate
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}
