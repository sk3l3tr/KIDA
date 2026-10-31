import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, inject } from '@angular/core';
import { restoreDialogFocus, trapDialogFocus } from './dialog-focus';

/** Dialog state and callback validity belong to the caller, never to this shared service. */
@Injectable({ providedIn: 'root' })
export class NativeDialogService {
  private readonly document = inject(DOCUMENT);

  captureFocus(): Element | null {
    return this.document.activeElement;
  }

  open(dialog: HTMLDialogElement | undefined): void {
    if (!dialog) throw new Error('Confirmation unavailable');
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
  }

  close(dialog: HTMLDialogElement | undefined): void {
    if (dialog?.open) dialog.close();
  }

  trapFocus(event: KeyboardEvent, dialog: HTMLDialogElement | undefined): void {
    trapDialogFocus(event, dialog, this.document);
  }

  restoreFocus(
    injector: Injector,
    trigger: Element | null,
    fallback: () => HTMLElement | undefined,
    isCurrent: () => boolean,
  ): void {
    restoreDialogFocus(injector, trigger, fallback, isCurrent);
  }
}
