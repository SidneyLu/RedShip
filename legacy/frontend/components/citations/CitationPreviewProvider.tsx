'use client';

import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import type { CitationPreviewCard } from '@/lib/api';
import { api } from '@/lib/api';
import { TransitionLink } from '@/components/TransitionLink';
import { parseCitationHref, type CitationHrefContext } from '@/components/citations/utils';

interface CitationPreviewContextValue {
  scheduleOpen: (href: string, anchorEl: HTMLElement | null) => void;
  scheduleClose: (delay?: number) => void;
  holdOpen: () => void;
  closeNow: () => void;
  isHoverEnabled: boolean;
}

const CitationPreviewContext = createContext<CitationPreviewContextValue | null>(null);

export function useCitationPreview() {
  const value = useContext(CitationPreviewContext);
  if (!value) {
    throw new Error('useCitationPreview must be used within CitationPreviewProvider');
  }
  return value;
}

interface PreviewState {
  href: string;
  context: CitationHrefContext;
  anchorEl: HTMLElement | null;
}

interface CitationPreviewProviderProps {
  token: string | null;
  children: ReactNode;
}

function cacheKeyFor(context: CitationHrefContext): string {
  return context.kind === 'run'
    ? `run:${context.runId}:${context.citationId}`
    : `message:${context.threadId}:${context.messageId}:${context.citationId}`;
}

export function CitationPreviewProvider({ token, children }: CitationPreviewProviderProps) {
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [card, setCard] = useState<CitationPreviewCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [routeKey, setRouteKey] = useState('');
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef(new Map<string, CitationPreviewCard>());
  const isHoverEnabled = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }, []);

  const { refs, floatingStyles } = useFloating({
    open: Boolean(previewState),
    placement: 'right-start',
    middleware: [offset(14), flip(), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  });

  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const closeNow = () => {
    clearOpenTimer();
    clearCloseTimer();
    setPreviewState(null);
    setCard(null);
    setLoading(false);
  };

  useEffect(() => {
    refs.setReference(previewState?.anchorEl ?? null);
  }, [previewState?.anchorEl, refs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const currentRoute = () => `${window.location.pathname}?${window.location.search}`;
    const notifyRouteChange = () => {
      setRouteKey(currentRoute());
    };

    notifyRouteChange();
    window.addEventListener('popstate', notifyRouteChange);
    window.addEventListener('hashchange', notifyRouteChange);

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args as Parameters<History['pushState']>);
      notifyRouteChange();
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args as Parameters<History['replaceState']>);
      notifyRouteChange();
      return result;
    };

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', notifyRouteChange);
      window.removeEventListener('hashchange', notifyRouteChange);
    };
  }, []);

  useEffect(() => {
    if (!routeKey) return;
    closeNow();
  }, [routeKey]);

  useEffect(() => {
    const onScroll = () => closeNow();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeNow();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const floatingEl = refs.floating.current;
      const anchorEl = previewState?.anchorEl ?? null;
      if (floatingEl?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      closeNow();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [previewState, refs.floating]);

  useEffect(() => {
    if (!previewState || !token) return;
    const context = previewState.context;
    const key = cacheKeyFor(context);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setCard(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setCard(null);

    const load = async () => {
      try {
        const next =
          context.kind === 'run'
            ? ((await api.getResearchRunCitationPreview(context.runId, context.citationId, 'card', token)) as CitationPreviewCard)
            : ((await api.getThreadMessageCitationPreview(
                context.threadId,
                context.messageId,
                context.citationId,
                'card',
                token,
              )) as CitationPreviewCard);
        if (cancelled) return;
        cacheRef.current.set(key, next);
        setCard(next);
      } catch {
        if (!cancelled) {
          setCard(null);
        }
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
  }, [previewState, token]);

  const value = useMemo<CitationPreviewContextValue>(
    () => ({
      scheduleOpen: (href: string, anchorEl: HTMLElement | null) => {
        if (!isHoverEnabled || !token) return;
        const context = parseCitationHref(href);
        if (!context || !anchorEl) return;
        clearCloseTimer();
        clearOpenTimer();
        openTimerRef.current = setTimeout(() => {
          setPreviewState({ href, context, anchorEl });
        }, 380);
      },
      scheduleClose: (delay = 190) => {
        clearOpenTimer();
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
          setPreviewState(null);
          setCard(null);
          setLoading(false);
        }, delay);
      },
      holdOpen: () => {
        clearCloseTimer();
      },
      closeNow,
      isHoverEnabled,
    }),
    [isHoverEnabled, token],
  );

  return (
    <CitationPreviewContext.Provider value={value}>
      {children}
      {previewState && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className='z-[120] w-[min(520px,calc(100vw-2rem))]'
              onMouseEnter={value.holdOpen}
              onMouseLeave={() => value.scheduleClose()}
            >
              <TransitionLink
                href={card?.href ?? previewState.href}
                direction='forward'
                onClick={() => value.closeNow()}
                className='block cursor-pointer rounded-[1.25rem] border border-zinc-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]'
              >
                <article className='max-h-[480px] overflow-hidden rounded-[1.25rem]'>
                  <header className='border-b border-zinc-100 px-5 py-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='truncate text-xl font-semibold leading-8 text-zinc-900'>
                          {card?.title ?? '加载预览中...'}
                        </p>
                        {card?.subtitle ? <p className='mt-1 text-sm text-zinc-500'>{card.subtitle}</p> : null}
                      </div>
                      <div className='shrink-0 rounded-full bg-crimson-50 px-3 py-1 text-xs font-semibold text-crimson-700'>
                        {typeof card?.score === 'number' ? `score ${card.score.toFixed(2)}` : `可信度 ${card?.trust_score?.toFixed(2) ?? '--'}`}
                      </div>
                    </div>
                    {card?.locator_label ? <p className='mt-3 text-sm text-zinc-500'>{card.locator_label}</p> : null}
                  </header>
                  <div className='max-h-[340px] overflow-y-auto px-5 py-4 text-[15px] leading-8 text-zinc-700'>
                    {loading ? '正在加载引用预览...' : card?.excerpt ?? '当前引用暂无可展示摘录。'}
                  </div>
                  <footer className='border-t border-zinc-100 px-5 py-3 text-right text-sm font-medium text-crimson-700'>
                    点击查看完整文档
                  </footer>
                </article>
              </TransitionLink>
            </div>,
            document.body,
          )
        : null}
    </CitationPreviewContext.Provider>
  );
}
