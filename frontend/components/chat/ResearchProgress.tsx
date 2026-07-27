"use client";

/** 深度研究模式侧边进度：将 research_step 事件映射为步骤 UI。 */

import { useMemo, useState } from "react";
import {
  Loader2,
  Search,
  Compass,
  Lightbulb,
  PencilLine,
  BookOpen,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchStep } from "@/lib/chat-types";

const STEP_LABELS: Record<string, string> = {
  local_retrieve: "本地检索",
  planning: "规划子问题",
  plan_ready: "规划完成",
  outline_ready: "已输出提纲",
  iteration_begin: "开始检索",
  searching: "正在联网搜索",
  search_completed: "搜索完成",
  extracted: "已抽取证据",
  iteration_summary: "本轮汇总",
  interim_summary: "阶段性摘要",
  reflecting: "正在反思评估",
  reflection_done: "反思完成",
  writing: "撰写研究报告",
  analysis: "查询分析",
};

function stepIcon(step: string) {
  if (step === "planning" || step === "plan_ready") return Compass;
  if (step.includes("search") || step === "extracted") return Search;
  if (step.includes("reflect")) return Lightbulb;
  if (step === "writing") return PencilLine;
  if (step === "iteration_begin" || step === "iteration_summary") return Sparkles;
  return BookOpen;
}

export function ResearchProgress({
  steps,
  loading,
  stage,
  compact = false,
  title = "深度研究进度",
}: {
  steps: ResearchStep[];
  loading: boolean;
  stage: string | null;
  compact?: boolean;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const filteredSteps = useMemo(
    () => steps.filter((s) => s.step !== "extracted" || s.title || s.url),
    [steps]
  );

  if (!loading && filteredSteps.length === 0 && !stage) return null;

  if (compact) {
    const visibleSteps = filteredSteps.slice(-5);
    const latest = visibleSteps[visibleSteps.length - 1];
    const LatestIcon = latest ? stepIcon(latest.step) : Sparkles;
    const latestLabel = latest
      ? `${STEP_LABELS[latest.step] || latest.step}${latest.iteration ? ` · 第 ${latest.iteration} 轮` : ""}`
      : stage || (loading ? "处理中" : "已完成");

    return (
      <section className="mt-1.5 shrink-0 rounded-xl border border-border bg-canvas/60">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
          aria-expanded={expanded}
        >
          <Sparkles className="h-3 w-3 shrink-0 text-crimson-700" />
          <span className="shrink-0 text-[11px] font-semibold text-crimson-800">{title}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
            <LatestIcon className="mr-1 inline h-3 w-3 align-[-1px] text-crimson-600" />
            {latestLabel}
            {latest?.title || latest?.query
              ? ` · ${latest.title || latest.query}`
              : stage && latest
                ? ` · ${stage}`
                : ""}
          </span>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-crimson-600" />
          ) : (
            <span className="shrink-0 text-[10px] text-muted">完成</span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted transition",
              expanded && "rotate-180"
            )}
          />
        </button>
        {expanded && visibleSteps.length > 0 ? (
          <div className="scroll-pretty flex gap-1.5 overflow-x-auto border-t border-border/70 px-2 py-1.5">
            {visibleSteps.map((s, idx) => {
              const Icon = stepIcon(s.step);
              const label = STEP_LABELS[s.step] || s.step;
              return (
                <div
                  key={`${s.step}-${idx}`}
                  className="flex min-w-[140px] max-w-[200px] items-start gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px]"
                >
                  <Icon className="mt-0.5 h-3 w-3 shrink-0 text-crimson-700" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">
                      {label}
                      {s.iteration ? <span className="ml-1 text-muted">第 {s.iteration} 轮</span> : null}
                    </div>
                    <div className="mt-0.5 truncate text-muted">
                      {s.title || s.query || s.plan_summary || s.snippet || "处理中"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <aside className="panel max-h-[70vh] w-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-crimson-800">
          <Sparkles className="h-4 w-4" />
          {title}
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-crimson-600" />
        ) : (
          <span className="text-xs text-muted">已完成</span>
        )}
      </div>
      {stage && (
        <div className="border-b border-border bg-canvas/60 px-4 py-2 text-xs text-muted">
          当前阶段：<span className="text-crimson-700">{stage}</span>
        </div>
      )}
      <ol className="scroll-pretty max-h-[55vh] overflow-y-auto px-4 py-3 text-sm">
        {filteredSteps.map((s, idx) => {
          const Icon = stepIcon(s.step);
          const label = STEP_LABELS[s.step] || s.step;
          return (
            <li key={idx} className="relative mb-3 last:mb-0 border-l border-border pl-4">
              <span className="absolute -left-[7px] top-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-crimson-500/15 ring-2 ring-canvas">
                <Icon className="h-3 w-3 text-crimson-700" />
              </span>
              <div className="font-medium text-ink">
                {label}
                {s.iteration ? <span className="ml-1 text-xs text-muted">· 第 {s.iteration} 轮</span> : null}
              </div>
              {s.plan_summary && (
                <div className="mt-1 text-xs text-muted">{s.plan_summary}</div>
              )}
              {s.sub_questions && s.sub_questions.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted">
                  {s.sub_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              )}
              {s.follow_ups && s.follow_ups.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-amber-700">
                  {s.follow_ups.map((q, i) => (
                    <li key={i}>追问：{q}</li>
                  ))}
                </ul>
              )}
              {s.gaps && s.gaps.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-crimson-700">
                  {s.gaps.map((g, i) => (
                    <li key={i}>缺口：{g}</li>
                  ))}
                </ul>
              )}
              {s.query && <div className="mt-1 text-xs italic text-muted">“{s.query}”</div>}
              {s.title && (
                <a
                  href={s.url || "#"}
                  target={s.url ? "_blank" : undefined}
                  rel="noreferrer noopener"
                  className="mt-1 block truncate text-xs text-crimson-700 hover:underline"
                >
                  {s.title}
                </a>
              )}
              {s.snippet && <div className="mt-1 text-xs text-muted">{s.snippet}</div>}
              {(s.sources !== undefined || s.extracts !== undefined) && (
                <div className="mt-1 text-xs text-muted">
                  {s.sources !== undefined ? `搜索 ${s.sources} 条` : ""}
                  {s.extracts !== undefined ? ` · 抽取 ${s.extracts} 条` : ""}
                </div>
              )}
              {(s.new_extracts !== undefined || s.total_extracts !== undefined) && (
                <div className="mt-1 text-xs text-muted">
                  新增证据 {s.new_extracts ?? 0} 条 · 累计 {s.total_extracts ?? 0}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
