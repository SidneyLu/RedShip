'use client';

import { StageRuntimeState, stageLabel, stageStatusLabel, stageStatusTone } from '@/components/home/utils';

interface ProgressStripProps {
  status: string;
  phase: string;
  currentRound: number;
  maxRounds: number;
  headline?: string | null;
  reportPhase?: string | null;
  sectionCount?: number;
  completedSectionCount?: number;
  currentSectionTitle?: string | null;
  stages: StageRuntimeState[];
}

function reportPhaseLabel(phase: string | null | undefined) {
  if (phase === 'outline_ready') return '蓝图已就绪';
  if (phase === 'drafting_sections') return '逐节写作中';
  if (phase === 'final_draft_ready') return '正文已收敛';
  if (phase === 'visualizing_assets') return '附录生成中';
  if (phase === 'quality_refused') return '已收敛待重试';
  if (phase === 'completed') return '成品已完成';
  return '准备中';
}

export function ProgressStrip({
  status,
  phase,
  currentRound,
  maxRounds,
  headline,
  reportPhase,
  sectionCount,
  completedSectionCount,
  currentSectionTitle,
  stages,
}: ProgressStripProps) {
  const hasReportProgress = Boolean((sectionCount ?? 0) > 0 || reportPhase || currentSectionTitle);

  return (
    <div className='rounded-[1.6rem] border border-zinc-200 bg-white/90 p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400'>研究进度</p>
          <p className='mt-1 text-sm font-semibold text-zinc-900'>
            {status} / {phase}
          </p>
          <p className='mt-1 text-xs text-zinc-500'>
            当前轮次 {currentRound}/{maxRounds}
          </p>
        </div>
        {headline ? <p className='max-w-[540px] text-sm text-zinc-600'>{headline}</p> : null}
      </div>

      {hasReportProgress ? (
        <div className='mt-4 rounded-[1.4rem] border border-crimson-100 bg-crimson-50/40 p-3'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-crimson-700'>报告写作</p>
              <p className='mt-1 text-sm font-semibold text-zinc-900'>
                {reportPhaseLabel(reportPhase)}
                {typeof sectionCount === 'number' && sectionCount > 0 ? ` · ${completedSectionCount ?? 0}/${sectionCount}` : ''}
              </p>
            </div>
            {currentSectionTitle ? <p className='max-w-[520px] text-sm text-zinc-600'>当前章节：{currentSectionTitle}</p> : null}
          </div>
        </div>
      ) : null}

      <div className='mt-4 grid gap-2 md:grid-cols-4'>
        {stages.map((item) => (
          <div key={item.stage} className='rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 text-xs'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-semibold text-zinc-800'>{stageLabel(item.stage)}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${stageStatusTone(item.status)}`}>
                {stageStatusLabel(item.status)}
              </span>
            </div>
            <p className='mt-2 text-zinc-600'>{item.model || '待命中模型'}</p>
            {item.detail ? <p className='mt-1 text-zinc-500'>{item.detail}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
