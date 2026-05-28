'use client';

import { useEffect, useState } from 'react';

import { ClarificationQuestion } from '@/lib/api';

interface PlanCardProps {
  awaitingPlanReview: boolean;
  clarificationQuestions: ClarificationQuestion[];
  planGoal: string;
  planSteps: string[];
  planDirty: boolean;
  busy: boolean;
  onGoalChange: (value: string) => void;
  onStepChange: (index: number, value: string) => void;
  onRemoveStep: (index: number) => void;
  onAddStep: () => void;
  onSavePlan: () => void;
  onConfirmPlan: () => void;
  onClarifySubmit: (responses: string[]) => void;
}

export function PlanCard({
  awaitingPlanReview,
  clarificationQuestions,
  planGoal,
  planSteps,
  planDirty,
  busy,
  onGoalChange,
  onStepChange,
  onRemoveStep,
  onAddStep,
  onSavePlan,
  onConfirmPlan,
  onClarifySubmit,
}: PlanCardProps) {
  const [responses, setResponses] = useState<string[]>([]);

  useEffect(() => {
    setResponses(clarificationQuestions.map(() => ''));
  }, [clarificationQuestions]);

  if (clarificationQuestions.length > 0) {
    return (
      <div className='rounded-3xl border border-crimson-100 bg-white p-4'>
        <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>澄清问题</p>
        <div className='mt-3 space-y-3'>
          {clarificationQuestions.map((item, index) => (
            <label key={item.id} className='block rounded-2xl border border-crimson-100 bg-crimson-50/30 p-3'>
              <span className='text-sm font-semibold text-zinc-900'>{item.question}</span>
              {item.rationale ? <p className='mt-1 text-xs text-zinc-500'>{item.rationale}</p> : null}
              <textarea
                className='input mt-3 min-h-[84px] text-sm'
                value={responses[index] ?? ''}
                onChange={(event) => {
                  const next = [...responses];
                  next[index] = event.target.value;
                  setResponses(next);
                }}
                placeholder='请输入你的补充说明'
              />
            </label>
          ))}
          <button className='btn-primary px-4 py-2 text-sm' onClick={() => onClarifySubmit(responses)} disabled={busy}>
            提交澄清
          </button>
        </div>
      </div>
    );
  }

  if (!awaitingPlanReview) {
    return (
      <div className='rounded-3xl border border-crimson-100 bg-white p-4'>
        <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>研究计划</p>
        <p className='mt-2 text-sm font-semibold text-zinc-900'>{planGoal}</p>
        <ol className='mt-3 space-y-2 text-sm text-zinc-600'>
          {planSteps.map((step, index) => (
            <li key={`summary-step-${index}`} className='rounded-2xl border border-crimson-100 bg-crimson-50/30 px-3 py-2'>
              {index + 1}. {step}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className='rounded-3xl border border-crimson-100 bg-white p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>研究计划</p>
          <p className='mt-1 text-sm text-zinc-500'>确认后将自动开始执行，右侧不再常驻显示。</p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button className='btn-outline px-3 py-2 text-xs' onClick={onSavePlan} disabled={busy || !planDirty}>
            保存计划
          </button>
          <button className='btn-primary px-3 py-2 text-xs' onClick={onConfirmPlan} disabled={busy}>
            确认并执行
          </button>
        </div>
      </div>

      <div className='mt-4 space-y-3'>
        <label className='block'>
          <span className='text-xs font-semibold text-zinc-600'>研究目标</span>
          <input className='input mt-2 text-sm' value={planGoal} onChange={(event) => onGoalChange(event.target.value)} />
        </label>
        <div className='space-y-2'>
          {planSteps.map((step, index) => (
            <div key={`plan-step-${index}`} className='flex items-center gap-2'>
              <input className='input text-sm' value={step} onChange={(event) => onStepChange(index, event.target.value)} />
              <button className='btn-outline px-3 py-2 text-xs' onClick={() => onRemoveStep(index)} disabled={planSteps.length <= 1 || busy}>
                删除
              </button>
            </div>
          ))}
        </div>
        <button className='btn-outline px-3 py-2 text-xs' onClick={onAddStep} disabled={busy}>
          新增步骤
        </button>
      </div>
    </div>
  );
}
