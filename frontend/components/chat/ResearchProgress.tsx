"use client";

import { useMemo } from "react";
import { Loader2, Search, Compass, Lightbulb, PencilLine, BookOpen, Sparkles } from "lucide-react";
import type { ResearchStep } from "./useChatStream";

const STEP_LABELS: Record<string, string> = {
  planning: "规划子问题",
  plan_ready: "规划完成",
  iteration_begin: "开始检索",
  searching: "正在联网搜索",
  search_completed: "搜索完成",
  extracted: "已抽取证据",
  iteration_summary: "本轮汇总",
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
}: {
  steps: ResearchStep[];
  loading: boolean;
  stage: string | null;
}) {
  const filteredSteps = useMemo(
    () => steps.filter((s) => s.step !== "extracted" || s.title || s.url),
    [steps]
  );

  if (!loading && filteredSteps.length === 0) return null;

  return (
    <aside className="panel max-h-[70vh] w-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-crimson-800">
          <Sparkles className="h-4 w-4" />
          深度研究进度
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
