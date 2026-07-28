"use client";

/** Evidence / plan board for deep research steps + final citations. */

import { useMemo, useState } from "react";
import type { Citation } from "@/lib/api";
import type { ResearchStep } from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import { ExternalLink, FileText, Globe, Library } from "lucide-react";

type Filter = "all" | "web" | "kb" | "session" | "plan";

interface Props {
  steps: ResearchStep[];
  citations: Citation[];
  onCitationClick?: (citation: Citation) => void;
}

function sourceIcon(type: string) {
  if (type === "web") return Globe;
  if (type === "session") return FileText;
  return Library;
}

export function EvidencePanel({ steps, citations, onCitationClick }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const plan = useMemo(() => {
    const ready = [...steps].reverse().find((s) => s.step === "plan_ready" || s.step === "outline_ready");
    const reflect = [...steps].reverse().find((s) => s.step === "reflection_done");
    return { ready, reflect };
  }, [steps]);

  const extracts = useMemo(
    () =>
      steps.filter(
        (s) =>
          s.step === "extracted" ||
          (s.step === "search_completed" && (s.title || s.url || s.snippet))
      ),
    [steps]
  );

  const filteredCitations = useMemo(() => {
    if (filter === "all" || filter === "plan") return citations;
    return citations.filter((c) => {
      const t = String(c.source_type || "");
      if (filter === "kb") return t === "kb" || t === "bibliography";
      return t === filter;
    });
  }, [citations, filter]);

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "plan", label: "提纲" },
    { id: "web", label: "网页" },
    { id: "kb", label: "文献" },
    { id: "session", label: "会话" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px]",
              filter === f.id
                ? "bg-crimson-50 text-crimson-800"
                : "text-muted hover:bg-canvas hover:text-ink"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {(filter === "all" || filter === "plan") && (plan.ready || plan.reflect) ? (
          <section className="rounded-lg border border-border bg-canvas/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-crimson-700">
              研究提纲
            </p>
            {plan.ready?.plan_summary ? (
              <p className="mt-1 text-ink">{plan.ready.plan_summary}</p>
            ) : null}
            {plan.ready?.sub_questions?.length ? (
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-ink/90">
                {plan.ready.sub_questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            ) : null}
            {plan.reflect?.gaps?.length ? (
              <div className="mt-2">
                <p className="text-[10px] font-semibold text-muted">缺口</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink/80">
                  {plan.reflect.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.reflect?.follow_ups?.length ? (
              <div className="mt-2">
                <p className="text-[10px] font-semibold text-muted">跟进问题</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink/80">
                  {plan.reflect.follow_ups.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {filter !== "plan" ? (
          <>
            {filteredCitations.length > 0 ? (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-crimson-700">
                  引用证据 ({filteredCitations.length})
                </p>
                {filteredCitations.map((c) => {
                  const Icon = sourceIcon(String(c.source_type || "kb"));
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onCitationClick?.(c)}
                      className="flex w-full items-start gap-2 rounded-lg border border-border bg-white p-2.5 text-left transition-colors hover:border-crimson-200 hover:bg-crimson-50/40"
                    >
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-crimson-700" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          ({c.ordinal}) {c.title || c.id}
                        </span>
                        {c.snippet ? (
                          <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted">
                            {c.snippet}
                          </span>
                        ) : null}
                      </span>
                      {c.url ? (
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
                      ) : null}
                    </button>
                  );
                })}
              </section>
            ) : null}

            {extracts.length > 0 && filter === "all" ? (
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-crimson-700">
                  检索摘录 ({extracts.length})
                </p>
                {extracts.slice(-30).map((s, i) => (
                  <div
                    key={`${s.step}-${s.url || s.title || i}-${s.timestamp || i}`}
                    className="rounded-lg border border-border/80 bg-canvas/40 p-2.5"
                  >
                    <p className="truncate text-xs font-medium text-ink">
                      {s.title || s.query || s.url || s.step}
                    </p>
                    {s.snippet ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{s.snippet}</p>
                    ) : null}
                    {typeof s.session_hits === "number" || typeof s.kb_hits === "number" ? (
                      <p className="mt-1 text-[10px] text-muted">
                        会话 {s.session_hits ?? 0} · 文献 {s.kb_hits ?? 0}
                      </p>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null}

            {!filteredCitations.length && !extracts.length ? (
              <div className="flex flex-col items-center justify-center gap-1 py-10 text-center text-sm text-muted">
                <p>暂无证据</p>
                <p className="text-xs">深度研究检索与引用就绪后会汇集到此。</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
