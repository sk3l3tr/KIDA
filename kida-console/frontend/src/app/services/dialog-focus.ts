import { Injector, afterNextRender } from '@angular/core';

/** Wrap the existing dialog buttons only at the Tab boundaries. */
export function trapDialogFocus(
  event: KeyboardEvent,
  dialog: HTMLDialogElement | undefined,
  document: Document,
): void {
  if (event.key !== 'Tab') return;
  const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button');
  if (!buttons?.length) return;
  const first = buttons[0],
    last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Resolve the fallback after rendering; the page guards its session/generation. */
export function restoreDialogFocus(
  injector: Injector,
  trigger: Element | null,
  fallback: () => HTMLElement | undefined,
  isCurrent: () => boolean,
): void {
  afterNextRender(
    {
      write: () => {
        if (!isCurrent()) return;
        const target =
          trigger instanceof HTMLElement && trigger.isConnected && !trigger.matches(':disabled')
            ? trigger
            : fallback();
        target?.focus({ preventScroll: true });
      },
    },
    { injector },
  );
}
