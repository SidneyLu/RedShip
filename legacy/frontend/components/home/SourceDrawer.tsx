'use client';

import { X } from 'lucide-react';

import { ResearchSourceRecord, SourcePolicy } from '@/lib/api';
import { sourceReasonLabel, sourceStatusLabel, trustLevelLabel, trustLevelTone } from '@/components/home/utils';

interface SourceDrawerProps {
  open: boolean;
  sources: ResearchSourceRecord[];
  sourcePolicy: SourcePolicy | null;
  whitelistInput: string;
  sourcePolicyBusy: boolean;
  onClose: () => void;
  onWhitelistChange: (value: string) => void;
  onToggleWebEnabled: (next: boolean) => void;
  onSaveSourcePolicy: () => void;
}

export function SourceDrawer({
  open,
  sources,
  sourcePolicy,
  whitelistInput,
  sourcePolicyBusy,
  onClose,
  onWhitelistChange,
  onToggleWebEnabled,
  onSaveSourcePolicy,
}: SourceDrawerProps) {
  if (!open) return null;

  return (
    <>
      <button className='fixed inset-0 z-40 bg-zinc-900/30' aria-label='关闭来源抽屉' onClick={onClose} />
      <aside className='fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-crimson-100 bg-[#fbf8f4] p-4 shadow-2xl'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>来源与策略</p>
            <h2 className='mt-1 text-lg font-semibold text-zinc-900'>来源抽屉</h2>
          </div>
          <button className='btn-outline px-2 py-1 text-xs' onClick={onClose} aria-label='关闭来源抽屉'>
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='mt-4 rounded-3xl border border-crimson-100 bg-white p-4'>
          <p className='text-sm font-semibold text-zinc-900'>来源策略</p>
          <label className='mt-3 flex items-center gap-2 text-sm text-zinc-700'>
            <input
              type='checkbox'
              checked={Boolean(sourcePolicy?.web_enabled)}
              onChange={(event) => onToggleWebEnabled(event.target.checked)}
            />
            联网补证
          </label>
          <label className='mt-3 block'>
            <span className='text-xs font-semibold text-zinc-600'>站点白名单</span>
            <textarea
              className='input mt-2 min-h-[84px] text-sm'
              value={whitelistInput}
              onChange={(event) => onWhitelistChange(event.target.value)}
              placeholder='gov.cn people.com.cn xinhuanet.com'
            />
          </label>
          <button className='btn-primary mt-3 px-4 py-2 text-xs' onClick={onSaveSourcePolicy} disabled={sourcePolicyBusy}>
            保存来源策略
          </button>
        </div>

        <div className='mt-4 flex-1 space-y-3 overflow-y-auto pr-1'>
          {sources.length === 0 ? (
            <div className='rounded-3xl border border-crimson-100 bg-white p-4 text-sm text-zinc-500'>当前尚无来源记录。</div>
          ) : null}
          {sources.map((item) => {
            const metadata = item.metadata ?? {};
            const viaBrowser = Boolean(metadata?.via_browser);
            const hop = typeof metadata?.hop === 'number' ? metadata.hop : typeof metadata?.hop === 'string' ? Number(metadata.hop) : null;
            const browserSummary = typeof metadata?.browser_summary === 'string' ? metadata.browser_summary : null;
            return (
              <article key={item.id} className='rounded-3xl border border-crimson-100 bg-white p-4 text-sm'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-semibold text-zinc-900'>{item.title}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    item.status === 'adopted'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : item.status === 'rejected'
                        ? 'border-zinc-200 bg-zinc-100 text-zinc-600'
                        : 'border-crimson-200 bg-crimson-50 text-crimson-700'
                  }`}
                >
                  {sourceStatusLabel(item.status)}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${trustLevelTone(item.trust_level)}`}>
                  {trustLevelLabel(item.trust_level)}
                </span>
                {viaBrowser ? (
                  <span className='rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700'>
                    已浏览
                  </span>
                ) : null}
                {viaBrowser && hop != null ? (
                  <span className='rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600'>
                    hop {hop}
                  </span>
                ) : null}
              </div>
              <p className='mt-2 text-xs text-zinc-500'>
                {item.source_type}
                {item.domain ? ` | ${item.domain}` : ''}
                {item.location ? ` | ${item.location}` : ''}
              </p>
              {item.excerpt ? <p className='mt-2 text-zinc-600'>{item.excerpt.slice(0, 180)}</p> : null}
              {browserSummary ? <p className='mt-2 rounded-2xl bg-sky-50 px-3 py-2 text-xs leading-6 text-sky-800'>浏览摘要：{browserSummary}</p> : null}
              <p className='mt-2 text-xs text-zinc-500'>原因：{sourceReasonLabel(item.reject_reason)}</p>
              {item.url ? (
                <a className='mt-2 inline-block text-sm text-crimson-700 underline' href={item.url} target='_blank' rel='noreferrer'>
                  打开来源
                </a>
              ) : null}
              </article>
            );
          })}
        </div>
      </aside>
    </>
  );
}
