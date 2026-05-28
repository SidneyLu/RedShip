'use client';

import { useMemo } from 'react';

import { ActivityTimelineNode, ResearchArtifactRecord } from '@/lib/api';
import { TimelineNode } from '@/components/home/TimelineNode';

interface ResearchActivityTimelineProps {
  nodes: ActivityTimelineNode[];
  artifacts?: ResearchArtifactRecord[];
  live?: boolean;
}

function latestUpdatedAt(nodes: ActivityTimelineNode[]) {
  let latest: string | null = null;
  nodes.forEach((node) => {
    const candidate = node.updated_at ?? node.created_at ?? null;
    if (!candidate) return;
    if (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) {
      latest = candidate;
    }
  });
  return latest;
}

export function ResearchActivityTimeline({ nodes, artifacts = [], live = false }: ResearchActivityTimelineProps) {
  if (nodes.length === 0) return null;
  const updatedAt = useMemo(() => latestUpdatedAt(nodes), [nodes]);
  const runningCount = nodes.filter((node) => node.status === 'running').length;

  return (
    <section className='rounded-[1.9rem] border border-zinc-200 bg-white/95 shadow-[0_10px_35px_rgba(39,39,42,0.05)]'>
      <div className='sticky top-0 z-10 rounded-t-[1.9rem] border-b border-zinc-200 bg-white/92 px-5 py-4 backdrop-blur'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='min-w-0'>
            <p className='text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400'>研究轨迹</p>
            <p className='mt-1 text-sm text-zinc-600'>
              {live ? '时间线正在持续接收新的研究事件与决策更新。' : '时间线已归档，可回看检索、筛选与收敛过程。'}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2 text-xs'>
            <span className={`rounded-full border px-3 py-1 font-semibold ${live ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-zinc-200 bg-zinc-50 text-zinc-500'}`}>
              {live ? '实时更新中' : '已归档'}
            </span>
            <span className='rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-zinc-600'>
              节点 {nodes.length}
            </span>
            {runningCount > 0 ? (
              <span className='rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700'>
                进行中 {runningCount}
              </span>
            ) : null}
            {updatedAt ? (
              <span className='rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-500'>
                最近更新 {new Date(updatedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className='max-h-[70vh] overflow-y-auto px-5 py-5'>
        <div className='space-y-5 pr-1'>
          {nodes.map((node) => (
            <TimelineNode key={node.group_id} node={node} artifacts={artifacts} />
          ))}
        </div>
      </div>
    </section>
  );
}
