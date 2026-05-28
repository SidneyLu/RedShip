"use client";

/** 知识库文档表格与筛选。 */

import { formatDateTime } from "@/lib/utils";
import type { KnowledgeDoc } from "@/lib/api";

interface Props {
  docs: KnowledgeDoc[];
  loading?: boolean;
  error?: string | null;
  onDelete?: (doc: KnowledgeDoc) => void;
  canDelete?: boolean;
}

export function KnowledgeList({ docs, loading, error, onDelete, canDelete }: Props) {
  return (
    <div className="overflow-x-auto scroll-pretty">
      {error && <div className="mb-4 text-sm text-crimson-700">{error}</div>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted">
            <th className="px-3 py-2">标题</th>
            <th className="px-3 py-2">来源</th>
            <th className="px-3 py-2">丛书</th>
            <th className="px-3 py-2">历史时期</th>
            <th className="px-3 py-2">父块</th>
            <th className="px-3 py-2">状态</th>
            <th className="px-3 py-2">更新时间</th>
            {canDelete && <th className="px-3 py-2">操作</th>}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={canDelete ? 8 : 7} className="px-3 py-6 text-center text-muted">
                加载中…
              </td>
            </tr>
          )}
          {!loading && docs.length === 0 && (
            <tr>
              <td colSpan={canDelete ? 8 : 7} className="px-3 py-6 text-center text-muted">
                暂无文档；请确保 <code>bibliography/</code> 目录已挂载并触发同步。
              </td>
            </tr>
          )}
          {docs.map((d) => (
            <tr key={d.id} className="border-t border-border">
              <td className="px-3 py-2">
                <div className="font-medium text-ink">{d.title}</div>
                {d.relative_path && <div className="text-xs text-muted">{d.relative_path}</div>}
              </td>
              <td className="px-3 py-2 text-muted">{d.source}</td>
              <td className="px-3 py-2 text-muted">{d.series || "—"}</td>
              <td className="px-3 py-2 text-muted">{d.era || "—"}</td>
              <td className="px-3 py-2">{d.chunks_count}</td>
              <td className="px-3 py-2">
                <StatusPill status={d.status} />
                {d.error && <div className="mt-0.5 text-[10px] text-crimson-700">{d.error}</div>}
              </td>
              <td className="px-3 py-2 text-xs text-muted">{formatDateTime(d.updated_at)}</td>
              {canDelete && (
                <td className="px-3 py-2">
                  {d.source === "upload" && onDelete ? (
                    <button
                      type="button"
                      className="btn-ghost text-xs text-crimson-700"
                      onClick={() => onDelete(d)}
                    >
                      删除
                    </button>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "indexed"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : status === "failed"
      ? "bg-crimson-50 text-crimson-800 border-crimson-200"
      : "bg-amber-50 text-amber-800 border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {status}
    </span>
  );
}
