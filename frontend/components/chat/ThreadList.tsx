"use client";

import { useState } from "react";
import { MessageSquarePlus, Trash2, PinIcon, Sparkles, MessageSquare } from "lucide-react";
import { api, type Thread } from "@/lib/api";
import { useToast } from "@/components/providers/ToastProvider";
import { timeAgo, cn } from "@/lib/utils";

interface Props {
  threads: Thread[];
  activeId: string | null;
  onPick: (t: Thread) => void;
  onNew: () => void;
  onChange: () => void;
}

export function ThreadList({ threads, activeId, onPick, onNew, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const { show } = useToast();

  const pinToggle = async (t: Thread) => {
    setBusy(t.id);
    try {
      await api(`/api/threads/${t.id}`, { method: "PATCH", json: { pinned: !t.pinned } });
      onChange();
    } catch (e: any) {
      show({ title: "操作失败", description: String(e.message), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: Thread) => {
    if (!confirm(`确定要删除对话「${t.title}」吗？`)) return;
    setBusy(t.id);
    try {
      await api(`/api/threads/${t.id}`, { method: "DELETE" });
      onChange();
      if (activeId === t.id) onNew();
    } catch (e: any) {
      show({ title: "删除失败", description: String(e.message), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="panel hidden h-full min-h-[70vh] flex-col overflow-hidden lg:flex">
      <div className="border-b border-border p-3">
        <button type="button" onClick={onNew} className="btn-primary w-full justify-center">
          <MessageSquarePlus className="h-4 w-4" />
          新建对话
        </button>
      </div>
      <div className="scroll-pretty flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted">
            暂无对话，开始你的第一次提问吧。
          </div>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className={cn(
                "group mb-1 flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition",
                activeId === t.id
                  ? "bg-crimson-100 text-crimson-900"
                  : "hover:bg-canvas/80"
              )}
            >
              <span className="mt-0.5 text-crimson-600">
                {t.mode === "research" ? <Sparkles className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              </span>
              <span className="flex-1 truncate">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="block truncate text-[10px] uppercase tracking-wider text-muted">
                  {t.mode === "research" ? "深度研究" : "快速问答"} · {timeAgo(t.last_message_at || t.created_at)}
                </span>
              </span>
              <span className="invisible flex shrink-0 items-center gap-0.5 group-hover:visible">
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    pinToggle(t);
                  }}
                  className={cn(
                    "rounded-full p-1 hover:bg-canvas",
                    t.pinned ? "text-crimson-700" : "text-muted"
                  )}
                  title={t.pinned ? "取消置顶" : "置顶对话"}
                >
                  <PinIcon className="h-3.5 w-3.5" />
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(t);
                  }}
                  className="rounded-full p-1 text-muted hover:bg-canvas hover:text-crimson-700"
                  title="删除对话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
