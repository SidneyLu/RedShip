'use client';

import { useEffect } from 'react';

function isTransitionAbortInvalidState(reason: unknown): boolean {
  if (!reason) return false;
  const name = typeof reason === 'object' && reason && 'name' in reason ? String((reason as { name?: unknown }).name ?? '') : '';
  const message =
    typeof reason === 'string'
      ? reason
      : typeof reason === 'object' && reason && 'message' in reason
        ? String((reason as { message?: unknown }).message ?? '')
        : '';
  const text = `${name} ${message}`.toLowerCase();
  return text.includes('invalidstateerror') && text.includes('transition was aborted');
}

export function ViewTransitionGuard() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isTransitionAbortInvalidState(event.reason)) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}

