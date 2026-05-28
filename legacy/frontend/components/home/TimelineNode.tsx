'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import {
  ActivityTimelineEvent,
  ActivityTimelineNode,
  BrowserSnapshotArtifactPayload,
  ResearchArtifactRecord,
} from '@/lib/api';
import { SafeViewTransition } from '@/components/SafeViewTransition';
import { BrowserSnapshotCard, BrowserSnapshotView } from '@/components/home/BrowserSnapshotCard';
import { TimelineChips } from '@/components/home/TimelineChips';
import { TimelineEventLog } from '@/components/home/TimelineEventLog';

interface TimelineNodeProps {
  node: ActivityTimelineNode;
  artifacts?: ResearchArtifactRecord[];
}

function statusLabel(status: string) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'running') return '进行中';
  return '待推进';
}

function statusTone(status: string) {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'running') return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-zinc-200 bg-zinc-50 text-zinc-500';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeBrowserSnapshot(
  raw: Record<string, unknown>,
  fallbackId: string,
  fallbackDecision?: string | null,
): BrowserSnapshotView | null {
  const pageUrl = typeof raw.page_url === 'string' ? raw.page_url : typeof raw.current_url === 'string' ? raw.current_url : '';
  const pageTitle =
    typeof raw.page_title === 'string'
      ? raw.page_title
      : typeof raw.title === 'string'
        ? raw.title
        : typeof raw.label === 'string'
          ? raw.label
          : pageUrl;
  const excerpt =
    typeof raw.excerpt === 'string'
      ? raw.excerpt
      : typeof raw.summary === 'string'
        ? raw.summary
        : typeof raw.browser_summary === 'string'
          ? raw.browser_summary
          : null;
  const snapshotDataUrl =
    typeof raw.snapshot_data_url === 'string' ? raw.snapshot_data_url : typeof raw.preview_data_url === 'string' ? raw.preview_data_url : null;
  if (!pageUrl && !pageTitle) return null;
  if (!snapshotDataUrl && !excerpt && typeof raw.reason !== 'string') return null;
  return {
    id:
      (typeof raw.artifact_key === 'string' && raw.artifact_key) ||
      (typeof raw.artifact_id === 'string' && raw.artifact_id) ||
      fallbackId,
    pageUrl: pageUrl || '#',
    pageTitle: pageTitle || '网页页面',
    domain:
      typeof raw.domain === 'string'
        ? raw.domain
        : typeof raw.host === 'string'
          ? raw.host
          : null,
    excerpt,
    snapshotDataUrl,
    hop: typeof raw.hop === 'number' ? raw.hop : typeof raw.hop === 'string' ? Number(raw.hop) : null,
    action: typeof raw.action === 'string' ? raw.action : null,
    capturedAt:
      typeof raw.captured_at === 'string'
        ? raw.captured_at
        : typeof raw.created_at === 'string'
          ? raw.created_at
          : null,
    seedUrl: typeof raw.seed_url === 'string' ? raw.seed_url : null,
    parentUrl: typeof raw.parent_url === 'string' ? raw.parent_url : null,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    decision: typeof raw.decision === 'string' ? raw.decision : fallbackDecision ?? null,
  };
}

function snapshotFromArtifact(artifact: ResearchArtifactRecord): BrowserSnapshotView | null {
  if (artifact.artifact_type !== 'browser_snapshot') return null;
  const payload = asRecord(artifact.payload) as BrowserSnapshotArtifactPayload | null;
  if (!payload) return null;
  return normalizeBrowserSnapshot(payload as unknown as Record<string, unknown>, `artifact-${artifact.id}`);
}

function snapshotFromEvent(event: ActivityTimelineEvent): BrowserSnapshotView | null {
  const payload = asRecord(event.metadata);
  if (!payload) return null;
  const shouldTry =
    event.event_type === 'browser_snapshot_captured' ||
    event.event_type === 'browser_page_summarized' ||
    event.event_type === 'browser_path_decided';
  if (!shouldTry) return null;
  return normalizeBrowserSnapshot(payload, event.id, typeof payload.decision === 'string' ? payload.decision : null);
}

function resolveBrowserSnapshots(node: ActivityTimelineNode, artifacts: ResearchArtifactRecord[]) {
  const collected = new Map<string, BrowserSnapshotView>();
  const push = (row: BrowserSnapshotView | null) => {
    if (!row) return;
    const key = row.id || `${row.pageUrl}-${row.capturedAt ?? 'now'}`;
    collected.set(key, row);
  };

  node.event_log.forEach((item) => {
    push(snapshotFromEvent(item));
  });

  const artifactIds = new Set(
    node.artifacts
      .map((chip) => {
        const meta = asRecord(chip.metadata);
        return (typeof meta?.artifact_id === 'string' && meta.artifact_id) || (typeof meta?.artifact_key === 'string' && meta.artifact_key) || null;
      })
      .filter((value): value is string => Boolean(value)),
  );

  artifacts.forEach((artifact) => {
    if (artifact.artifact_type !== 'browser_snapshot') return;
    const payload = asRecord(artifact.payload);
    const artifactKey = typeof payload?.artifact_key === 'string' ? payload.artifact_key : null;
    const artifactRound =
      typeof payload?.round === 'number' ? payload.round : typeof payload?.round === 'string' ? Number(payload.round) : null;
    if (artifactIds.size > 0) {
      if (artifactIds.has(artifact.id) || (artifactKey && artifactIds.has(artifactKey))) {
        push(snapshotFromArtifact(artifact));
      }
      return;
    }
    if (node.round != null && artifactRound === node.round) {
      push(snapshotFromArtifact(artifact));
    }
  });

  return Array.from(collected.values()).sort((left, right) => {
    const leftTime = left.capturedAt ? new Date(left.capturedAt).getTime() : 0;
    const rightTime = right.capturedAt ? new Date(right.capturedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export function TimelineNode({ node, artifacts = [] }: TimelineNodeProps) {
  const [expanded, setExpanded] = useState(node.status === 'running');
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const active = node.status === 'running';
  const browserSnapshots = useMemo(() => resolveBrowserSnapshots(node, artifacts), [artifacts, node]);
  const visibleSnapshots = showAllSnapshots ? browserSnapshots : browserSnapshots.slice(0, 3);

  return (
    <SafeViewTransition name={`timeline-${node.group_id}`}>
      <article className='timeline-node-enter relative pl-8' style={{ contentVisibility: 'auto' }}>
        <div className={`absolute left-2 top-2 h-full w-px ${active ? 'bg-sky-200' : 'bg-zinc-200'}`} />
        <div
          className={`timeline-dot absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-white ${
            active
              ? 'timeline-dot-active bg-sky-500'
              : node.status === 'completed'
                ? 'bg-emerald-500'
                : node.status === 'failed'
                  ? 'bg-red-500'
                  : 'bg-zinc-300'
          }`}
        />

        <div className='rounded-[1.6rem] border border-zinc-200/80 bg-white/90 p-4 shadow-[0_8px_28px_rgba(39,39,42,0.05)] backdrop-blur'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='text-sm font-semibold text-zinc-900'>{node.title}</p>
              {node.summary ? <p className='mt-2 text-sm leading-7 text-zinc-600'>{node.summary}</p> : null}
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(node.status)}`}>{statusLabel(node.status)}</span>
          </div>

          <div className='mt-4 space-y-3'>
            <TimelineChips label='检索词' chips={node.queries} />
            <TimelineChips label='来源' chips={node.domains} />
            <TimelineChips label='产物' chips={node.artifacts} />
            {node.reason ? <p className='text-sm text-zinc-500'>接下来：{node.reason}</p> : null}
          </div>

          {browserSnapshots.length > 0 ? (
            <div className='mt-5 rounded-[1.4rem] border border-zinc-200 bg-zinc-50/80 p-3'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <p className='text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400'>浏览快照</p>
                  <p className='mt-1 text-sm text-zinc-600'>实时展示模型读取网页、筛选信息和决定下一跳的过程。</p>
                </div>
                <span className='rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500'>
                  页面 {browserSnapshots.length}
                </span>
              </div>

              <div className='mt-3 space-y-3'>
                {visibleSnapshots.map((snapshot, index) => (
                  <BrowserSnapshotCard key={snapshot.id} snapshot={snapshot} index={index} />
                ))}
              </div>

              {browserSnapshots.length > 3 ? (
                <button
                  className='mt-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800'
                  onClick={() => setShowAllSnapshots((prev) => !prev)}
                  type='button'
                >
                  {showAllSnapshots ? '收起浏览页面' : `查看更多页面（${browserSnapshots.length - 3}）`}
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAllSnapshots ? 'rotate-180' : ''}`} />
                </button>
              ) : null}
            </div>
          ) : null}

          {node.event_log.length > 0 ? (
            <div className='mt-4'>
              <button
                className='inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800'
                onClick={() => setExpanded((prev) => !prev)}
                type='button'
              >
                {expanded ? '收起细节' : '展开细节'}
                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          ) : null}

          {expanded ? (
            <div className='mt-4'>
              <TimelineEventLog rows={node.event_log} />
            </div>
          ) : null}
        </div>
      </article>
    </SafeViewTransition>
  );
}
