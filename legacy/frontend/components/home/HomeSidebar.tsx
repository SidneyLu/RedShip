'use client';

import { PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';

import { BrandCard } from '@/components/BrandCard';
import { TransitionLink } from '@/components/TransitionLink';
import { ThreadItem } from '@/lib/api';
import { ThreadList } from '@/components/home/ThreadList';

interface HomeSidebarProps {
  sidebarOpen: boolean;
  threadSearch: string;
  filteredThreads: ThreadItem[];
  activeThreadId: string | null;
  canCreate: boolean;
  isAdmin: boolean;
  onToggleSidebar: () => void;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onCreateResearch: () => void;
  onCreateThread: () => void;
}

export function HomeSidebar({
  sidebarOpen,
  threadSearch,
  filteredThreads,
  activeThreadId,
  canCreate,
  isAdmin,
  onToggleSidebar,
  onSearchChange,
  onSelectThread,
  onCreateResearch,
  onCreateThread,
}: HomeSidebarProps) {
  return (
    <>
      {sidebarOpen ? (
        <button
          className='fixed inset-0 z-30 bg-zinc-900/20 md:hidden'
          aria-label='关闭会话栏'
          onClick={onToggleSidebar}
        />
      ) : null}

      <aside
        className={`panel vt-persistent fixed inset-y-2 left-2 z-40 flex min-h-0 w-[86vw] max-w-[320px] flex-col transition-[transform,width,padding] duration-200 md:sticky md:top-2 md:z-10 md:h-[calc(100vh-1rem)] md:max-w-none md:self-start ${
          sidebarOpen
            ? 'translate-x-0 gap-3 p-3 opacity-100 md:w-[280px]'
            : '-translate-x-[120%] gap-3 p-3 opacity-0 md:translate-x-0 md:w-[72px] md:items-center md:gap-2 md:px-2 md:py-3 md:opacity-100'
        }`}
      >
        {sidebarOpen ? (
          <>
            <div className='flex items-start justify-between gap-3'>
              <BrandCard />
              <button className='btn-outline shrink-0 px-2 py-1 text-xs' onClick={onToggleSidebar} aria-label='收起线程栏'>
                <PanelLeftClose className='h-4 w-4' />
              </button>
            </div>

            <div className='grid grid-cols-2 gap-2'>
              <button className='btn-primary px-3 py-2 text-xs' onClick={onCreateResearch} disabled={!canCreate}>
                <Plus className='mr-1 h-4 w-4' /> 新建研究
              </button>
              <button className='btn-outline px-3 py-2 text-xs' onClick={onCreateThread} disabled={!canCreate}>
                <Plus className='mr-1 h-4 w-4' /> 新建会话
              </button>
            </div>

            <div className='relative'>
              <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400' />
              <input
                className='input py-2 pl-9 text-xs'
                value={threadSearch}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder='搜索线程'
              />
            </div>

            <div role='region' aria-label='线程列表' className='min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1'>
              <ThreadList
                threads={filteredThreads}
                activeThreadId={activeThreadId}
                onSelect={onSelectThread}
                emptyLabel='登录后会自动创建会话'
              />
            </div>

            <div className='grid grid-cols-1 gap-2'>
              <TransitionLink className='btn-outline justify-start px-3 py-2 text-xs' href='/profile' direction='forward'>
                账户
              </TransitionLink>
              {isAdmin ? (
                <TransitionLink className='btn-outline justify-start px-3 py-2 text-xs' href='/admin' direction='forward'>
                  管理员控制台
                </TransitionLink>
              ) : null}
            </div>
          </>
        ) : (
          <div className='hidden h-full w-full flex-col items-center gap-3 md:flex'>
            <button className='btn-outline px-2 py-2 text-xs' onClick={onToggleSidebar} aria-label='展开线程栏'>
              <PanelLeftOpen className='h-4 w-4' />
            </button>
            <div className='h-px w-full bg-crimson-100' />
            <p className='text-[11px] font-semibold tracking-[0.18em] text-crimson-700 [writing-mode:vertical-rl]'>线程</p>
          </div>
        )}

      </aside>

      {!sidebarOpen ? (
        <button
          className='btn-outline fixed left-3 top-3 z-20 px-2 py-1 text-xs md:hidden'
          onClick={onToggleSidebar}
          aria-label='展开线程栏'
        >
          <PanelLeftOpen className='h-4 w-4' />
        </button>
      ) : null}
    </>
  );
}
