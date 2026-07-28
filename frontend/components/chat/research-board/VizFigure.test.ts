import { describe, expect, it } from "vitest";
import type { VizSpec } from "@/lib/api";

/** Mirror VizFigure resolve rules without mounting ECharts. */
function resolveOption(viz: VizSpec | null | undefined): {
  option: Record<string, unknown> | null;
  error: string | null;
} {
  if (!viz || typeof viz !== "object") {
    return { option: null, error: "缺少可视化规格" };
  }
  const kind = viz.kind || "echarts";
  if (kind === "echarts") {
    if (!viz.option || typeof viz.option !== "object") {
      return { option: null, error: "ECharts 缺少 option" };
    }
    return { option: viz.option, error: null };
  }
  if (kind === "timeline") {
    if (!Array.isArray(viz.items) || !viz.items.length) {
      return { option: null, error: "时间线缺少 items" };
    }
    return { option: { series: [] }, error: null };
  }
  if (kind === "network") {
    if (!Array.isArray(viz.nodes) || !viz.nodes.length) {
      return { option: null, error: "关系网缺少 nodes" };
    }
    return { option: { series: [] }, error: null };
  }
  return { option: null, error: `不支持的 kind: ${kind}` };
}

describe("VizFigure resolve", () => {
  it("rejects missing option for echarts", () => {
    expect(resolveOption({ kind: "echarts" }).error).toMatch(/option/);
  });

  it("accepts valid echarts option", () => {
    const r = resolveOption({ kind: "echarts", option: { title: { text: "t" } } });
    expect(r.error).toBeNull();
    expect(r.option?.title).toEqual({ text: "t" });
  });

  it("rejects empty timeline", () => {
    expect(resolveOption({ kind: "timeline", items: [] }).error).toMatch(/items/);
  });
});
