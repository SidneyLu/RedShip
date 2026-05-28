'use client';

import { useRef, type ReactNode } from 'react';

import { TransitionLink } from '@/components/TransitionLink';
import { useCitationPreview } from '@/components/citations/CitationPreviewProvider';

interface CitationChipProps {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'report-inline';
}

const VARIANT_CLASS_NAMES: Record<NonNullable<CitationChipProps['variant']>, string> = {
  default:
    'inline-flex cursor-pointer items-center rounded-full border border-[#f4cfd0] bg-[#fff1f1] px-3 py-1 text-sm font-medium text-[#c05759] shadow-[0_2px_10px_rgba(249,115,115,0.08)] transition-colors hover:bg-[#ffe7e8]',
  'report-inline':
    'inline-flex cursor-pointer items-center rounded-[0.9rem] border border-zinc-200 bg-zinc-50 px-2.5 py-[1px] text-[0.8em] font-medium leading-6 text-zinc-700 no-underline shadow-none transition-colors hover:border-zinc-300 hover:bg-zinc-100',
};

export function CitationChip({ href, children, className, variant = 'default' }: CitationChipProps) {
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const { scheduleOpen, scheduleClose, holdOpen, closeNow } = useCitationPreview();
  const resolvedClassName = [VARIANT_CLASS_NAMES[variant], className].filter(Boolean).join(' ');

  return (
    <TransitionLink
      href={href}
      direction='forward'
      ref={anchorRef as any}
      className={resolvedClassName}
      data-citation-variant={variant}
      onMouseEnter={() => {
        holdOpen();
        scheduleOpen(href, anchorRef.current);
      }}
      onMouseLeave={() => scheduleClose()}
      onFocus={() => scheduleOpen(href, anchorRef.current)}
      onBlur={() => scheduleClose()}
      onClick={() => closeNow()}
    >
      {children}
    </TransitionLink>
  );
}
