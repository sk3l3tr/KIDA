import { Injector, afterNextRender } from '@angular/core';

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
