'use client';

import { FileSearch, ShieldCheck, UploadCloud } from 'lucide-react';

import { ComposerMode } from '@/components/home/utils';

interface ResearchComposerProps {
  value: string;
  composerMode: ComposerMode;
  retrievalEnabled: boolean;
  retrievalScope: 'base' | 'upload' | 'hybrid';
  attachmentCount: number;
  busy: boolean;
  backendReady: boolean;
  canUseUploads: boolean;
  canUpload: boolean;
  submitLabel?: string;
  onChangeValue: (value: string) => void;
  onChangeMode: (mode: ComposerMode) => void;
  onChangeRetrievalEnabled: (next: boolean) => void;
  onChangeRetrievalScope: (next: 'base' | 'upload' | 'hybrid') => void;
  onUpload: (file: File) => void;
  onSubmit: () => void;
}

export function ResearchComposer({
  value,
  composerMode,
  retrievalEnabled,
  retrievalScope,
  attachmentCount,
  busy,
  backendReady,
  canUseUploads,
  canUpload,
  submitLabel,
  onChangeValue,
  onChangeMode,
  onChangeRetrievalEnabled,
  onChangeRetrievalScope,
  onUpload,
  onSubmit,
}: ResearchComposerProps) {
  const buttonLabel = submitLabel ?? (composerMode === 'ask' ? '发送' : '深度研究');

  return (
    <div className='sticky bottom-0 mt-4'>
      <div className='rounded-[2rem] border border-crimson-100 bg-white/95 p-3 shadow-soft backdrop-blur'>
        <textarea
          className='input min-h-[96px] resize-none text-sm'
          placeholder='输入研究任务、追问或追加说明...'
          value={value}
          onChange={(event) => onChangeValue(event.target.value)}
        />
        <div className='mt-3 flex flex-wrap items-center gap-2'>
          <div className='inline-flex rounded-xl border border-crimson-200 bg-white p-0.5 text-xs'>
            <button
              className={`rounded-lg px-3 py-2 ${composerMode === 'ask' ? 'bg-crimson-600 text-white' : 'text-crimson-700'}`}
              onClick={() => onChangeMode('ask')}
              aria-label='切换到发送模式'
            >
              普通追问
            </button>
            <button
              className={`rounded-lg px-3 py-2 ${composerMode === 'research' ? 'bg-crimson-600 text-white' : 'text-crimson-700'}`}
              onClick={() => onChangeMode('research')}
              aria-label='切换到深度研究模式'
            >
              研究指令
            </button>
          </div>

          <label className='flex items-center gap-2 rounded-full border border-crimson-200 bg-white px-3 py-2 text-xs text-zinc-700'>
            <input type='checkbox' checked={retrievalEnabled} onChange={(event) => onChangeRetrievalEnabled(event.target.checked)} />
            检索
          </label>

          <select
            className='input max-w-[190px] py-2 text-xs'
            value={retrievalScope}
            onChange={(event) => onChangeRetrievalScope(event.target.value as 'base' | 'upload' | 'hybrid')}
          >
            <option value='base'>基础知识库</option>
            <option value='upload' disabled={!canUseUploads}>
              上传资料
            </option>
            <option value='hybrid' disabled={!canUseUploads}>
              混合检索
            </option>
          </select>

          <label className='btn-outline cursor-pointer px-3 py-2 text-xs'>
            <UploadCloud className='mr-1 h-4 w-4' /> 上传资料
            <input
              type='file'
              accept='image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.md'
              className='hidden'
              disabled={!canUpload || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.currentTarget.value = '';
              }}
            />
          </label>

          <button className='btn-primary ml-auto px-4 py-2 text-sm' onClick={onSubmit} disabled={busy || !backendReady}>
            {composerMode === 'ask' ? <FileSearch className='mr-1 h-4 w-4' /> : <ShieldCheck className='mr-1 h-4 w-4' />}
            {buttonLabel}
          </button>
        </div>
        <div className='mt-2 flex items-center justify-between text-xs text-zinc-500'>
          <span>当前附件引用 {attachmentCount} 个</span>
          {!backendReady ? <span>后端连接中，请稍候…</span> : null}
        </div>
      </div>
    </div>
  );
}
