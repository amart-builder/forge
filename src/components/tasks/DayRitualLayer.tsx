'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DayRitualLayerProps {
  labelledBy: string;
  describedBy?: string;
  announcement?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  inertTargetRef?: RefObject<HTMLElement | null>;
  width?: 'default' | 'wide';
  onEscape: () => void;
  children: ReactNode;
}

export default function DayRitualLayer({
  labelledBy,
  describedBy,
  announcement,
  initialFocusRef,
  inertTargetRef,
  width = 'default',
  onEscape,
  children,
}: DayRitualLayerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const escapeHandlerRef = useRef(onEscape);

  useEffect(() => {
    escapeHandlerRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const inertTarget = inertTargetRef?.current;
    const wasInert = inertTarget?.hasAttribute('inert') ?? false;
    if (inertTarget) inertTarget.setAttribute('inert', '');

    const focusDialog = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ?? dialogRef.current)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        escapeHandlerRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      ).filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const focusIsOutside = !dialogRef.current?.contains(activeElement);
      if (
        event.shiftKey &&
        (activeElement === first || activeElement === dialogRef.current || focusIsOutside)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener('keydown', handleKeyDown);
      if (inertTarget && !wasInert) inertTarget.removeAttribute('inert');
      window.requestAnimationFrame(() => returnFocus?.focus());
    };
  }, [inertTargetRef, initialFocusRef]);

  return (
    <div
      className="absolute inset-0 z-[100] overflow-y-auto overscroll-contain bg-background/70 p-3 backdrop-blur-md sm:p-6"
      data-day-ritual-layer
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`mx-auto flex min-h-full w-full flex-col justify-center outline-none ${
          width === 'wide' ? 'max-w-7xl' : 'max-w-3xl'
        }`}
      >
        {children}
      </section>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

export type { DayRitualLayerProps };
