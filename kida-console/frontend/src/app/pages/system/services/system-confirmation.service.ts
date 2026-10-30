import { DOCUMENT } from '@angular/common';
import { AfterRenderRef, Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { PendingAction, actionLabels } from '../utils/system.models';

export interface SystemConfirmation {
  present(): Promise<boolean>;
  cancel(): void;
  restoreFocus(): void;
}

@Injectable()
export class SystemConfirmationService {
  private readonly alerts = inject(AlertController);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  prepare(pending: PendingAction, isCurrent: () => boolean): SystemConfirmation {
    return new ConfirmationSession(
      this.alerts,
      this.injector,
      this.document.activeElement,
      pending,
      isCurrent,
    );
  }
}

class ConfirmationSession implements SystemConfirmation {
  private cancelled = false;
  private dialog: HTMLIonAlertElement | undefined;
  private focusRef: AfterRenderRef | undefined;
  private result: Promise<boolean> | undefined;
  private resolveResult: ((confirmed: boolean) => void) | undefined;
  private rejectResult: ((failure: unknown) => void) | undefined;
  private removed = false;

  constructor(
    private readonly alerts: AlertController,
    private readonly injector: Injector,
    private trigger: Element | null,
    private readonly pending: PendingAction,
    private readonly isCurrent: () => boolean,
  ) {}

  present(): Promise<boolean> {
    if (!this.result) {
      this.result = new Promise<boolean>((resolve, reject) => {
        this.resolveResult = resolve;
        this.rejectResult = reject;
      });
      void this.showDialog().then(
        (confirmed) => this.finish(confirmed),
        (failure) => {
          this.rejectResult?.(failure);
          this.clearResultHandlers();
        },
      );
    }
    return this.result;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.clearFocus();
    this.trigger = null;
    this.result ??= Promise.resolve(false);
    this.finish(false);
    const dialog = this.dialog;
    this.dialog = undefined;
    if (dialog) this.dismissDialog(dialog);
  }

  restoreFocus(): void {
    this.clearFocus();
    if (!this.valid()) return;
    this.focusRef = afterNextRender(
      () => {
        this.focusRef = undefined;
        if (this.valid() && this.trigger instanceof HTMLElement && this.trigger.isConnected) {
          this.trigger.focus({ preventScroll: true });
        }
      },
      { injector: this.injector },
    );
  }

  private valid(): boolean {
    return !this.cancelled && this.isCurrent();
  }

  private async showDialog(): Promise<boolean> {
    if (!this.valid()) return false;
    try {
      const dialog = await this.alerts.create({
        header: `Confirmar: ${actionLabels[this.pending.action]}`,
        message: confirmationMessage(this.pending),
        cssClass: 'system-confirmation',
        backdropDismiss: false,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Confirmar', role: 'confirm' },
        ],
      });
      if (!this.valid()) {
        this.removeDialog(dialog);
        return false;
      }
      this.dialog = dialog;
      await dialog.present();
      if (!this.valid()) {
        // cancel() owns an in-flight Ionic dismissal; do not detach ahead of its teardown.
        if (!this.cancelled) this.removeDialog(dialog);
        this.dialog = undefined;
        return false;
      }
      dialog.querySelector<HTMLButtonElement>('.alert-button-role-cancel')?.focus();
      const { role } = await dialog.onDidDismiss();
      this.dialog = undefined;
      return this.valid() && role === 'confirm';
    } catch (failure) {
      if (this.dialog) this.removeDialog(this.dialog);
      this.dialog = undefined;
      throw failure;
    }
  }

  private finish(confirmed: boolean): void {
    this.resolveResult?.(confirmed);
    this.clearResultHandlers();
  }

  private clearResultHandlers(): void {
    this.resolveResult = undefined;
    this.rejectResult = undefined;
  }

  private dismissDialog(dialog: HTMLIonAlertElement): void {
    try {
      // Let Ionic restore accessibility and scrolling before detaching the overlay.
      // The confirmation result has already settled, even if teardown stays pending.
      void dialog.dismiss(undefined, 'cancel').then(
        () => this.removeDialog(dialog),
        () => this.removeDialog(dialog),
      );
    } catch {
      this.removeDialog(dialog);
    }
  }

  private removeDialog(dialog: HTMLIonAlertElement): void {
    if (this.removed) return;
    this.removed = true;
    dialog.remove();
  }

  private clearFocus(): void {
    this.focusRef?.destroy();
    this.focusRef = undefined;
  }
}

function confirmationMessage(pending: PendingAction): string {
  // The summary uses the same frozen parameters that will be executed.
  let summary: string;
  if (pending.action === 'powerCycle') {
    const wake =
      'wake_time' in pending.body
        ? `Encendido a las ${pending.body.wake_time}`
        : `Encendido en ${pending.body.wake_after_seconds} segundos`;
    summary = `${wake}; apagado: ${pending.body.shutdown_time ?? '+1'}.`;
  } else {
    summary = `Cuándo: ${pending.body.when}.`;
  }
  return `${summary} Horas locales del servidor. La operación puede desconectar el equipo.`;
}
