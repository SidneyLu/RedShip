'use client';

import React, { Fragment, ReactNode } from 'react';

interface SafeViewTransitionProps {
  name?: string;
  children: ReactNode;
}

export function SafeViewTransition({ name, children }: SafeViewTransitionProps) {
  const NativeViewTransition = (React as unknown as { ViewTransition?: React.ComponentType<{ name?: string; children: ReactNode }> }).ViewTransition;
  if (!NativeViewTransition) {
    return <Fragment>{children}</Fragment>;
  }
  return <NativeViewTransition name={name}>{children}</NativeViewTransition>;
}
