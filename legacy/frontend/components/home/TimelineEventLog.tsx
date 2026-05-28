'use client';

import { ActivityTimelineEvent } from '@/lib/api';

interface TimelineEventLogProps {
  rows: ActivityTimelineEvent[];
}

function eventTone(status: string) {
  if (status === 'completed') return 'text-emerald-700';
  if (status === 'failed') return 'text-red-600';
  if (status === 'running') return 'text-sky-700';
  return 'text-zinc-600';
}

export function TimelineEventLog({ rows }: TimelineEventLogProps) {
  if (rows.length === 0) return null;

  return (
    <div className='rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3'>
      <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400'>事件日志</p>
      <div className='mt-3 space-y-3'>
        {rows.map((item) => (
          <div key={item.id} className='flex gap-3 text-sm'>
            <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${item.status === 'completed' ? 'bg-emerald-500' : item.status === 'failed' ? 'bg-red-500' : 'bg-sky-500'}`} />
            <div className='min-w-0'>
              <p className={`font-medium ${eventTone(item.status)}`}>{item.label}</p>
              {item.summary ? <p className='mt-1 text-zinc-600'>{item.summary}</p> : null}
              {item.created_at ? <p className='mt-1 text-xs text-zinc-400'>{new Date(item.created_at).toLocaleTimeString()}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
