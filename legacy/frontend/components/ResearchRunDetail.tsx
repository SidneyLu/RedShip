'use client';

import { useEffect, useMemo, useState } from 'react';

import { api, ResearchRun } from '@/lib/api';
import { loadAuthState } from '@/lib/auth';
import { CitationPreviewProvider } from '@/components/citations/CitationPreviewProvider';
import { MarkdownReport } from '@/components/MarkdownReport';
import { TransitionLink } from '@/components/TransitionLink';

interface Props {
  runId: string;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'refused']);

function parseWhitelistInput(raw: string): string[] {
  return raw
    .split(/[\n,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildWorkspaceHref(
  threadId: string | null | undefined,
  runId: string | null | undefined,
  view: 'workspace' | 'reader' | null | undefined,
) {
  const params = new URLSearchParams();
  if (threadId) {
    params.set('threadId', threadId);
  }
  if (runId) {
    params.set('runId', runId);
  }
  if (view) {
    params.set('view', view);
  }
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export function ResearchRunDetail({ runId }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [whitelistInput, setWhitelistInput] = useState('');
  const [isWhitelistDirty, setIsWhitelistDirty] = useState(false);

  const isAwaitingReview = run?.status === 'awaiting_confirmation';
  const isPlanReview = run?.phase === 'plan_review';
  const isRoundReview = run?.phase === 'round_review';
  const routeSelection = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        threadId: null,
        runId: null,
        view: null as 'workspace' | 'reader' | null,
      };
    }
    const params = new URLSearchParams(window.location.search);
    const viewRaw = params.get('view');
    const view: 'workspace' | 'reader' | null = viewRaw === 'reader' || viewRaw === 'workspace' ? viewRaw : null;
    return {
      threadId: params.get('threadId'),
      runId: params.get('runId'),
      view,
    };
  }, []);
  const returnHref = buildWorkspaceHref(
    routeSelection.threadId ?? run?.thread_id,
    routeSelection.runId ?? run?.id ?? runId,
    routeSelection.view ?? run?.view_recommendation ?? null,
  );

  useEffect(() => {
    const auth = loadAuthState();
    setToken(auth.token ?? null);
  }, []);

  useEffect(() => {
    if (!token || !runId) {
      setRun(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      try {
        const row = await api.getResearchRun(runId, token);
        if (cancelled) return;
        setRun(row);
        setError('');
        if (!isWhitelistDirty) {
          setWhitelistInput((row.site_whitelist ?? []).join(', '));
        }
        if (!TERMINAL_STATUSES.has(row.status)) {
          timer = setTimeout(refresh, row.status === 'awaiting_confirmation' ? 1800 : 1100);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || '加载研究详情失败');
        timer = setTimeout(refresh, 2000);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, runId, isWhitelistDirty]);

  const currentRoundCard = useMemo(() => {
    if (!run?.round_card || typeof run.round_card !== 'object') return null;
    return run.round_card as Record<string, unknown>;
  }, [run]);

  async function handleAdvance(action: 'continue' | 'revise' | 'stop') {
    if (!token || !run) return;
    try {
      setActionBusy(true);
      setError('');
      const payload: {
        action: 'continue' | 'revise' | 'stop';
        instructions?: string;
        site_whitelist?: string[];
      } = { action };
      if (action === 'revise' && instructions.trim()) {
        payload.instructions = instructions.trim();
      }
      if (isWhitelistDirty) {
        payload.site_whitelist = parseWhitelistInput(whitelistInput);
      }
      const next = await api.advanceResearchRun(run.id, payload, token);
      setRun(next);
      if (action !== 'revise') {
        setInstructions('');
      }
      setIsWhitelistDirty(false);
    } catch (err: any) {
      setError(err.message || '推进轮次失败');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleExecutionModeSwitch(mode: 'auto' | 'manual') {
    if (!token || !run || run.execution_mode === mode) return;
    try {
      setModeBusy(true);
      setError('');
      const next = await api.setResearchRunExecutionMode(run.id, mode, token);
      setRun(next);
      if (mode === 'auto' && next.status === 'awaiting_confirmation' && next.phase === 'round_review') {
        const resumed = await api.advanceResearchRun(run.id, { action: 'continue' }, token);
        setRun(resumed);
      }
    } catch (err: any) {
      setError(err.message || '切换执行模式失败');
    } finally {
      setModeBusy(false);
    }
  }

  if (loading) {
    return <main className='min-h-screen p-4 text-sm text-zinc-600'>加载研究详情中...</main>;
  }

  if (!token) {
    return (
      <main className='min-h-screen p-4 text-sm text-zinc-700'>
        未登录，无法查看研究详情。
        <TransitionLink href={returnHref} className='ml-2 text-crimson-700 underline' direction='back'>
          返回工作台
        </TransitionLink>
      </main>
    );
  }

  if (!run) {
    return (
      <main className='min-h-screen p-4 text-sm text-zinc-700'>
        未找到对应研究任务。
        <TransitionLink href={returnHref} className='ml-2 text-crimson-700 underline' direction='back'>
          返回工作台
        </TransitionLink>
      </main>
    );
  }

  const qualityGate = (run.quality_gate ?? {}) as Record<string, unknown>;
  const claimsPassed = Number(qualityGate.claims_passed ?? 0);
  const claimCount = Number(qualityGate.claim_count ?? 0);
  const passed = Boolean(qualityGate.passed);

  return (
    <main className='min-h-screen p-3 md:p-4'>
      <div className='mx-auto grid max-w-7xl gap-3 lg:grid-cols-[360px_1fr]'>
        <aside className='panel vt-persistent p-3'>
          <div className='flex items-center justify-between'>
            <h1 className='text-sm font-bold text-crimson-800'>深度研究详情</h1>
            <TransitionLink href={returnHref} className='text-xs text-crimson-700 underline' direction='back'>
              返回工作台
            </TransitionLink>
          </div>
          {error ? <p className='mt-2 text-xs text-red-600'>{error}</p> : null}

          <div className='mt-3 rounded-xl border border-crimson-100 bg-white p-3 text-xs'>
            <p className='font-semibold text-zinc-800'>状态：{run.status}</p>
            <p className='mt-1 text-zinc-600'>阶段：{run.phase}</p>
            <p className='mt-1 text-zinc-600'>模式：{run.execution_mode === 'auto' ? '自动' : '手动'}</p>
            <p className='mt-1 text-zinc-600'>
              轮次：{run.current_round}/{run.max_rounds}
            </p>
            <p className='mt-1 text-zinc-600'>任务：{run.question}</p>
            {run.stop_recommendation ? <p className='mt-2 text-crimson-700'>{run.stop_recommendation}</p> : null}
          </div>

          {isAwaitingReview ? (
            <div className='mt-3 rounded-xl border border-crimson-100 bg-white p-3 text-xs'>
              <p className='font-semibold text-crimson-700'>{isPlanReview ? '计划确认' : '轮次确认'}</p>
              {currentRoundCard ? (
                <div className='mt-2 space-y-2 text-zinc-700'>
                  <p className='font-semibold'>{String(currentRoundCard.summary ?? '')}</p>
                  {Array.isArray(currentRoundCard.key_findings) && currentRoundCard.key_findings.length > 0 ? (
                    <div>
                      <p className='text-[11px] font-semibold text-zinc-600'>关键发现</p>
                      <ul className='mt-1 list-disc space-y-1 pl-4'>
                        {(currentRoundCard.key_findings as unknown[]).map((item, idx) => (
                          <li key={`finding-${idx}`}>{String(item)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {Array.isArray(currentRoundCard.gaps) && currentRoundCard.gaps.length > 0 ? (
                    <div>
                      <p className='text-[11px] font-semibold text-zinc-600'>证据缺口</p>
                      <ul className='mt-1 list-disc space-y-1 pl-4'>
                        {(currentRoundCard.gaps as unknown[]).map((item, idx) => (
                          <li key={`gap-${idx}`}>{String(item)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className='mt-2 text-zinc-600'>等待当前轮次卡片数据...</p>
              )}

              <label className='mt-3 block'>
                <span className='text-[11px] font-semibold text-zinc-600'>改写指令（可选）</span>
                <textarea
                  className='input mt-1 min-h-[84px] text-xs'
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder='例如：优先补充政策执行时点和地域差异证据。'
                />
              </label>

              <label className='mt-2 block'>
                <span className='text-[11px] font-semibold text-zinc-600'>站点白名单（逗号/空格分隔）</span>
                <textarea
                  className='input mt-1 min-h-[60px] text-xs'
                  value={whitelistInput}
                  onChange={(event) => {
                    setWhitelistInput(event.target.value);
                    setIsWhitelistDirty(true);
                  }}
                  placeholder='gov.cn, people.com.cn, xinhuanet.com'
                />
              </label>

              <div className='mt-3 flex flex-wrap gap-2'>
                <button
                  className='btn-outline px-2 py-1 text-xs'
                  onClick={() => handleExecutionModeSwitch('auto')}
                  disabled={modeBusy || actionBusy}
                >
                  自动模式
                </button>
                <button
                  className='btn-outline px-2 py-1 text-xs'
                  onClick={() => handleExecutionModeSwitch('manual')}
                  disabled={modeBusy || actionBusy}
                >
                  手动模式
                </button>
                <button className='btn-primary px-2 py-1 text-xs' onClick={() => handleAdvance('continue')} disabled={actionBusy}>
                  继续下一轮
                </button>
                <button className='btn-outline px-2 py-1 text-xs' onClick={() => handleAdvance('revise')} disabled={actionBusy}>
                  改写并继续
                </button>
                <button className='btn-outline px-2 py-1 text-xs' onClick={() => handleAdvance('stop')} disabled={actionBusy}>
                  停止并收敛
                </button>
              </div>
            </div>
          ) : null}

          <div className='mt-3 rounded-xl border border-crimson-100 bg-white p-3 text-xs text-zinc-700'>
            <p className='font-semibold text-crimson-700'>质量门槛</p>
            <p className='mt-1'>
              通过：<span className={passed ? 'text-emerald-700' : 'text-zinc-600'}>{passed ? '是' : '否'}</span>
            </p>
            <p className='mt-1'>
              论点覆盖：{claimsPassed}/{claimCount}
            </p>
            <p className='mt-1'>引用数量：{Number(qualityGate.citation_count ?? 0)}</p>
          </div>

          <div className='mt-3 rounded-xl border border-crimson-100 bg-white p-3 text-xs'>
            <p className='font-semibold text-crimson-700'>轮次日志</p>
            <div className='mt-2 max-h-[280px] space-y-2 overflow-y-auto pr-1'>
              {(run.round_journal ?? []).length === 0 ? <p className='text-zinc-500'>暂无轮次日志。</p> : null}
              {(run.round_journal ?? []).map((item, idx) => {
                const row = item as Record<string, unknown>;
                return (
                  <div key={`round-journal-${idx}`} className='rounded-lg border border-crimson-100 bg-crimson-50/30 p-2 text-zinc-700'>
                    <p className='font-semibold'>第 {String(row.round ?? idx + 1)} 轮</p>
                    <p className='mt-1 text-[11px]'>{String(row.summary ?? row.draft ?? '无摘要')}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className='panel p-3 md:p-4'>
          <h2 className='text-sm font-semibold text-crimson-800'>研究报告预览</h2>
          {run.final_report ? (
            <CitationPreviewProvider token={token}>
              <div className='mt-3 rounded-xl border border-crimson-100 bg-white p-3'>
                <MarkdownReport content={run.final_report} />
              </div>
            </CitationPreviewProvider>
          ) : (
            <p className='mt-2 text-xs text-zinc-500'>最终报告尚未生成，等待轮次推进或收敛完成。</p>
          )}
        </section>
      </div>
    </main>
  );
}
