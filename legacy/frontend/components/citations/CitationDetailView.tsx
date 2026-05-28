'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { TransitionLink } from '@/components/TransitionLink';
import { api, type CitationPreviewPage } from '@/lib/api';
import { loadAuthState } from '@/lib/auth';

type CitationDetailContext =
  | {
      kind: 'run';
      runId: string;
      citationId: string;
    }
  | {
      kind: 'message';
      threadId: string;
      messageId: string;
      citationId: string;
    };

interface CitationDetailViewProps {
  context: CitationDetailContext;
}

function highlightContent(text: string, highlight: string | null | undefined): ReactNode {
  const source = text ?? '';
  const needle = (highlight || '').trim();
  if (!needle) {
    return source;
  }

  const matchIndex = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (matchIndex >= 0) {
    const before = source.slice(0, matchIndex);
    const match = source.slice(matchIndex, matchIndex + needle.length);
    const after = source.slice(matchIndex + needle.length);
    return (
      <>
        {before}
        <mark className='rounded bg-[#ffe7b8] px-1 text-zinc-900'>{match}</mark>
        {after}
      </>
    );
  }

  return source;
}

export function CitationDetailView({ context }: CitationDetailViewProps) {
  const [token, setToken] = useState<string | null>(null);
  const [page, setPage] = useState<CitationPreviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const auth = loadAuthState();
    setToken(auth.token ?? null);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      try {
        const next =
          context.kind === 'run'
            ? ((await api.getResearchRunCitationPreview(context.runId, context.citationId, 'page', token)) as CitationPreviewPage)
            : ((await api.getThreadMessageCitationPreview(
                context.threadId,
                context.messageId,
                context.citationId,
                'page',
                token,
              )) as CitationPreviewPage);
        if (cancelled) return;
        setPage(next);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || '加载引用详情失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [context, token]);

  useEffect(() => {
    if (!page?.highlight_text || !contentRef.current) return;
    contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  const backHref =
    context.kind === 'run'
      ? `/research/${context.runId}`
      : `/?threadId=${encodeURIComponent(context.threadId)}`;
  const backLabel = context.kind === 'run' ? '返回研究报告' : '返回工作台';
  const metadataRows = useMemo(
    () =>
      Object.entries(page?.metadata || {})
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => ({ key, value: String(value) })),
    [page?.metadata],
  );

  return (
    <main className='min-h-screen p-3 md:p-4'>
      <div className='mx-auto max-w-6xl space-y-4'>
        <header className='panel p-4 md:p-5'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>Citation Detail</p>
              <h1 className='mt-2 text-2xl font-semibold text-zinc-900'>{page?.title ?? '引用详情'}</h1>
              {page?.subtitle ? <p className='mt-2 text-sm text-zinc-500'>{page.subtitle}</p> : null}
            </div>
            <TransitionLink href={backHref} direction='back' className='btn-outline px-3 py-2 text-xs'>
              {backLabel}
            </TransitionLink>
          </div>

          {!token ? <p className='mt-4 text-sm text-zinc-600'>未登录，无法查看引用详情。</p> : null}
          {loading ? <p className='mt-4 text-sm text-zinc-500'>正在加载引用详情...</p> : null}
          {error ? <p className='mt-4 text-sm text-red-600'>{error}</p> : null}

          {page ? (
            <div className='mt-4 flex flex-wrap gap-2 text-xs text-zinc-600'>
              {page.locator_label ? (
                <span className='rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1'>{page.locator_label}</span>
              ) : null}
              <span className='rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1'>
                {page.preview_mode === 'pdf'
                  ? `PDF${typeof page.page_hint === 'number' ? ` · 第 ${page.page_hint} 页` : ''}`
                  : page.preview_mode === 'image'
                    ? '图片资料'
                    : page.preview_mode === 'web'
                      ? '网页引用'
                      : '文本资料'}
              </span>
              {typeof page.score === 'number' ? (
                <span className='rounded-full border border-crimson-200 bg-crimson-50 px-3 py-1 text-crimson-700'>
                  score {page.score.toFixed(2)}
                </span>
              ) : null}
              <span className='rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1'>
                可信度 {page.trust_score.toFixed(2)}
              </span>
            </div>
          ) : null}
        </header>

        {page ? (
          <section className='grid gap-4 lg:grid-cols-[320px_1fr]'>
            <aside className='space-y-4'>
              <article className='panel p-4'>
                <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>命中摘录</p>
                <div className='mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-700'>
                  {highlightContent(page.highlight_text || page.excerpt || '暂无摘录。', page.highlight_text)}
                </div>
              </article>

              {page.external_url ? (
                <article className='panel p-4'>
                  <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>原始来源</p>
                  <a
                    href={page.external_url}
                    target='_blank'
                    rel='noreferrer'
                    className='mt-3 inline-flex text-sm text-crimson-700 underline decoration-crimson-300 underline-offset-4'
                  >
                    打开原始链接
                  </a>
                </article>
              ) : null}

              {metadataRows.length > 0 ? (
                <article className='panel p-4'>
                  <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>定位信息</p>
                  <dl className='mt-3 space-y-2 text-sm'>
                    {metadataRows.map((row) => (
                      <div key={row.key} className='rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-2'>
                        <dt className='text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400'>{row.key}</dt>
                        <dd className='mt-1 break-all text-zinc-700'>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ) : null}
            </aside>

            <article className='panel overflow-hidden'>
              <div className='border-b border-zinc-100 px-5 py-4'>
                <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>上下文正文</p>
                <p className='mt-2 text-sm text-zinc-500'>第一版定位粒度为页 / chunk / 段落摘录高亮，用于快速回到命中文献上下文。</p>
              </div>
              <div
                ref={contentRef}
                className='max-h-[72vh] overflow-y-auto whitespace-pre-wrap px-5 py-4 text-[15px] leading-8 text-zinc-700'
              >
                {page.content
                  ? highlightContent(page.content, page.highlight_text)
                  : page.excerpt || '当前引用暂无更完整的上下文内容。'}
              </div>
            </article>
          </section>
        ) : null}
      </div>
    </main>
  );
}
