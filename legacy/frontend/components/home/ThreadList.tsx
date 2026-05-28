'use client';

import { ThreadItem } from '@/lib/api';

interface ThreadListProps {
  threads: ThreadItem[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  emptyLabel: string;
}

export function ThreadList({ threads, activeThreadId, onSelect, emptyLabel }: ThreadListProps) {
  if (threads.length === 0) {
    return <div className='rounded-xl border border-crimson-100 bg-white p-3 text-xs text-zinc-500'>{emptyLabel}</div>;
  }

  return (
    <div className='space-y-2'>
      {threads.map((item) => (
        <button
          key={item.id}
          className={`w-full rounded-2xl border px-3 py-3 text-left text-xs transition-colors ${
            activeThreadId === item.id ? 'border-crimson-300 bg-crimson-50' : 'border-crimson-100 bg-white hover:bg-crimson-50/60'
          }`}
          onClick={() => onSelect(item.id)}
        >
          <p className='font-semibold text-zinc-800'>{item.title}</p>
          <p className='mt-1 line-clamp-2 text-zinc-500'>{item.latest_message_preview?.slice(0, 70) ?? '暂无消息'}</p>
        </button>
      ))}
    </div>
  );
}
