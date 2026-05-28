'use client';

import Link from 'next/link';
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

interface TransitionLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  children: ReactNode;
  direction?: 'forward' | 'back';
}

function supportsNativeViewTransition(): boolean {
  if (typeof document === 'undefined') return false;
  return typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === 'function';
}

export const TransitionLink = forwardRef<HTMLAnchorElement, TransitionLinkProps>(function TransitionLink(
  { href, children, direction = 'forward', onClick, ...rest },
  ref,
) {
  const transitionType = direction === 'back' ? 'nav-back' : 'nav-forward';
  return (
    <Link
      ref={ref}
      href={href}
      transitionTypes={[transitionType]}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        if (!supportsNativeViewTransition()) {
          return;
        }
        const root = document.documentElement;
        root.setAttribute('data-vt-nav', direction);
        window.setTimeout(() => {
          root.removeAttribute('data-vt-nav');
        }, 900);
      }}
    >
      {children}
    </Link>
  );
});
