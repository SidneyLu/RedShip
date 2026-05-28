'use client';

import { ReactNode } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';

import { ActivityTimelineNode, ResearchArtifactRecord, ResearchRun, ThreadMessage } from '@/lib/api';
import { ChatCitationStrip } from '@/components/citations/ChatCitationStrip';
import { SafeViewTransition } from '@/components/SafeViewTransition';
import { ResearchActivityTimeline } from '@/components/home/ResearchActivityTimeline';

interface ResearchTimelineProps {
  messages: ThreadMessage[];
  activeRun: ResearchRun | null;
  activityTimeline: ActivityTimelineNode[];
  artifacts?: ResearchArtifactRecord[];
  planNode?: ReactNode;
  progressNode?: ReactNode;
  reportNode?: ReactNode;
  workspaceView: 'workspace' | 'reader';
  busy: boolean;
  onEnterReader: () => void;
  onExitReader: () => void;
}

function renderMessage(item: ThreadMessage) {
  const isUser = item.role === 'user';
  const isSystem = item.role === 'system';
  const isAssistantChat = item.role === 'assistant' && item.message_type === 'chat';
  return (
    <article
      key={item.id}
      className={`rounded-[1.75rem] border px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'ml-auto w-fit max-w-[88%] border-crimson-300 bg-crimson-600 text-white'
          : isSystem
            ? 'border-zinc-200 bg-zinc-50 text-zinc-700'
            : 'border-crimson-100 bg-white text-zinc-800'
      }`}
    >
      <p className='whitespace-pre-wrap'>{item.content}</p>
      <p className='mt-3 text-[11px] opacity-80'>
        {item.message_type}
        {typeof item.confidence === 'number' ? ` | confidence ${item.confidence.toFixed(2)}` : ''}
        {item.refusal_reason ? ' | strict-refusal' : ''}
      </p>
      {isAssistantChat ? (
        <ChatCitationStrip threadId={item.thread_id} messageId={item.id} citations={item.citations} />
      ) : null}
    </article>
  );
}

function ReportPreviewCard({
  title,
  content,
  onEnterReader,
}: {
  title: string;
  content: string;
  onEnterReader: () => void;
}) {
  const preview = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 220);

  return (
    <SafeViewTransition name='report-preview-card'>
      <article className='rounded-[1.8rem] border border-crimson-200 bg-white p-5 shadow-[0_10px_30px_rgba(127,29,29,0.06)]'>
        <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>报告预览</p>
        <div className='mt-3 flex flex-wrap items-start justify-between gap-4'>
          <div className='min-w-0'>
            <h3 className='text-lg font-semibold text-zinc-900'>{title}</h3>
            <p className='mt-2 text-sm leading-7 text-zinc-600'>{preview}...</p>
          </div>
          <button className='btn-primary px-4 py-2 text-sm' onClick={onEnterReader} type='button'>
            <FileText className='mr-1 h-4 w-4' /> 进入沉浸阅读
          </button>
        </div>
      </article>
    </SafeViewTransition>
  );
}

export function ResearchTimeline({
  messages,
  activeRun,
  activityTimeline,
  artifacts = [],
  planNode,
  progressNode,
  reportNode,
  workspaceView,
  busy,
  onEnterReader,
  onExitReader,
}: ResearchTimelineProps) {
  if (workspaceView === 'reader' && reportNode) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center justify-between gap-3 rounded-[1.6rem] border border-zinc-200 bg-white px-4 py-3'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400'>阅读模式</p>
            <p className='mt-1 text-sm text-zinc-600'>研究流程仍已归档，可随时返回任务中心查看生成轨迹。</p>
          </div>
          <button className='btn-outline px-3 py-2 text-xs' onClick={onExitReader} type='button'>
            <ArrowLeft className='mr-1 h-4 w-4' /> 返回任务中心
          </button>
        </div>
        {reportNode}
      </div>
    );
  }

  return (
    <div className='space-y-5'>
      {progressNode}
      {planNode}

      {messages.map((item) => renderMessage(item))}

      <ResearchActivityTimeline
        nodes={activityTimeline}
        artifacts={artifacts}
        live={busy || Boolean(activeRun && !activeRun.final_report && activeRun.status !== 'awaiting_confirmation')}
      />

      {activeRun?.final_report ? (
        <ReportPreviewCard title={activeRun.question} content={activeRun.final_report} onEnterReader={onEnterReader} />
      ) : null}

      {reportNode && !activeRun?.final_report ? reportNode : null}
    </div>
  );
}
