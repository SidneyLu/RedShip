'use client';

import { ReactNode } from 'react';

import { MarkdownReport } from '@/components/MarkdownReport';
import { SafeViewTransition } from '@/components/SafeViewTransition';

interface ReportReaderProps {
  title?: string;
  content: string;
  actions?: ReactNode;
  transitionName?: string;
}

export function ReportReader({ title = '研究报告', content, actions, transitionName = 'report-reader' }: ReportReaderProps) {
  return (
    <SafeViewTransition name={transitionName}>
      <section className='rounded-[2rem] border border-crimson-100 bg-white p-5 md:p-7'>
        <div className='mx-auto max-w-5xl'>
          <div className='mb-6 flex items-center justify-between gap-3 border-b border-crimson-100 pb-4'>
            <div>
              <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>沉浸阅读</p>
              <h2 className='mt-1 text-xl font-semibold text-zinc-900'>{title}</h2>
            </div>
            {actions ? <div className='shrink-0'>{actions}</div> : null}
          </div>
          <MarkdownReport content={content} />
        </div>
      </section>
    </SafeViewTransition>
  );
}
