'use client';

import { ActivityTimelineChip } from '@/lib/api';

interface TimelineChipsProps {
  label: string;
  chips: ActivityTimelineChip[];
}

function chipTone(kind: ActivityTimelineChip['kind'], state: string) {
  if (kind === 'query') {
    return 'border-zinc-200 bg-white text-zinc-700';
  }
  if (state === 'adopted' || state === 'completed' || state === 'read') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (state === 'rejected' || state === 'failed') {
    return 'border-zinc-200 bg-zinc-100 text-zinc-500';
  }
  if (state === 'active' || state === 'running') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  return 'border-zinc-200 bg-zinc-50 text-zinc-600';
}

export function TimelineChips({ label, chips }: TimelineChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className='space-y-2'>
      <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400'>{label}</p>
      <div className='flex flex-wrap gap-2'>
        {chips.map((chip, index) => {
          const content = (
            <span
              className={`timeline-chip-enter inline-flex min-h-[32px] items-center rounded-full border px-3 py-1 text-xs transition-colors ${chipTone(chip.kind, chip.state)}`}
              style={{ animationDelay: `${index * 45}ms` }}
            >
              {chip.label}
            </span>
          );

          if (chip.url) {
            return (
              <a key={`${chip.kind}-${chip.label}-${index}`} href={chip.url} target='_blank' rel='noreferrer' className='no-underline'>
                {content}
              </a>
            );
          }

          return <span key={`${chip.kind}-${chip.label}-${index}`}>{content}</span>;
        })}
      </div>
    </div>
  );
}
