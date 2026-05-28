'use client';

import { ExternalLink, Footprints, Globe2, Route } from 'lucide-react';

export interface BrowserSnapshotView {
  id: string;
  pageUrl: string;
  pageTitle: string;
  domain?: string | null;
  excerpt?: string | null;
  snapshotDataUrl?: string | null;
  hop?: number | null;
  action?: string | null;
  capturedAt?: string | null;
  seedUrl?: string | null;
  parentUrl?: string | null;
  reason?: string | null;
  decision?: string | null;
}

function actionLabel(action?: string | null) {
  if (action === 'follow_link') return '继续浏览';
  if (action === 'seed_open') return '起始页面';
  if (action === 'open_page') return '读取页面';
  return '浏览';
}

function decisionTone(decision?: string | null) {
  if (decision === 'adopted') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (decision === 'rejected') return 'border-zinc-200 bg-zinc-100 text-zinc-600';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

function decisionLabel(decision?: string | null) {
  if (decision === 'adopted') return '已采纳';
  if (decision === 'rejected') return '已放弃';
  return '已读取';
}

export function BrowserSnapshotCard({
  snapshot,
  index = 0,
}: {
  snapshot: BrowserSnapshotView;
  index?: number;
}) {
  return (
    <article
      className='timeline-browser-enter overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-[#fcfbf8] shadow-[0_8px_24px_rgba(39,39,42,0.05)]'
      style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
    >
      {snapshot.snapshotDataUrl ? (
        <div className='border-b border-zinc-200 bg-zinc-100/70'>
          <img
            alt={`浏览快照：${snapshot.pageTitle}`}
            className='h-44 w-full object-cover object-top'
            loading='lazy'
            src={snapshot.snapshotDataUrl}
          />
        </div>
      ) : (
        <div className='flex h-28 items-center justify-center border-b border-zinc-200 bg-zinc-100/80 text-xs text-zinc-500'>
          页面已读取，当前未保留截图
        </div>
      )}

      <div className='space-y-3 p-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <p className='text-sm font-semibold text-zinc-900'>{snapshot.pageTitle}</p>
            <p className='mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500'>
              {snapshot.domain ? (
                <span className='inline-flex items-center gap-1'>
                  <Globe2 className='h-3.5 w-3.5' />
                  {snapshot.domain}
                </span>
              ) : null}
              {typeof snapshot.hop === 'number' ? (
                <span className='inline-flex items-center gap-1'>
                  <Footprints className='h-3.5 w-3.5' />
                  hop {snapshot.hop}
                </span>
              ) : null}
              {snapshot.action ? (
                <span className='inline-flex items-center gap-1'>
                  <Route className='h-3.5 w-3.5' />
                  {actionLabel(snapshot.action)}
                </span>
              ) : null}
            </p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${decisionTone(snapshot.decision)}`}>
            {decisionLabel(snapshot.decision)}
          </span>
        </div>

        {snapshot.excerpt ? <p className='text-sm leading-6 text-zinc-600'>{snapshot.excerpt}</p> : null}
        {snapshot.reason ? <p className='text-xs leading-6 text-zinc-500'>决策说明：{snapshot.reason}</p> : null}

        <div className='flex flex-wrap items-center gap-3 text-xs text-zinc-500'>
          <a
            className='inline-flex items-center gap-1 font-medium text-crimson-700 underline'
            href={snapshot.pageUrl}
            rel='noreferrer'
            target='_blank'
          >
            <ExternalLink className='h-3.5 w-3.5' />
            打开原网页
          </a>
          {snapshot.seedUrl && snapshot.seedUrl !== snapshot.pageUrl ? <span>seed: {snapshot.seedUrl}</span> : null}
        </div>
      </div>
    </article>
  );
}
