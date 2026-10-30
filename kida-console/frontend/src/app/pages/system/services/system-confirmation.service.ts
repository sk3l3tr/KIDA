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
    let trigger = this.document.activeElement;
    let cancelled = false;
    let alert: HTMLIonAlertElement | undefined;
    let focusRef: AfterRenderRef | undefined;
    let result: Promise<boolean> | undefined;
    let resolveResult: ((confirmed: boolean) => void) | undefined;
    let rejectResult: ((failure: unknown) => void) | undefined;
    let removed = false;
    const valid = () => !cancelled && isCurrent();
    const removeDialog = (dialog: HTMLIonAlertElement) => {
      if (removed) return;
      removed = true;
      dialog.remove();
    };
    const finish = (confirmed: boolean) => {
      resolveResult?.(confirmed);
      resolveResult = undefined;
      rejectResult = undefined;
    };
    const clearFocus = () => {
      focusRef?.destroy();
      focusRef = undefined;
    };

    const show = async (): Promise<boolean> => {
      if (!valid()) return false;
      // The summary uses the same frozen parameters that will be executed.
      const summary =
        pending.action === 'powerCycle'
          ? `${'wake_time' in pending.body ? 'Encendido a las ' + pending.body.wake_time : 'Encendido en ' + pending.body.wake_after_seconds + ' segundos'}; apagado: ${pending.body.shutdown_time ?? '+1'}.`
          : `Cuándo: ${pending.body.when}.`;
      try {
        const dialog = await this.alerts.create({
          header: `Confirmar: ${actionLabels[pending.action]}`,
          message: `${summary} Horas locales del servidor CORE. La operación puede desconectar el equipo.`,
          cssClass: 'system-confirmation',
          backdropDismiss: false,
          buttons: [
            { text: 'Cancelar', role: 'cancel' },
            { text: 'Confirmar', role: 'confirm' },
          ],
        });
        if (!valid()) {
          removeDialog(dialog);
          return false;
        }
        alert = dialog;
        await dialog.present();
        if (!valid()) {
          // cancel() owns an in-flight Ionic dismissal; do not detach ahead of its teardown.
          if (!cancelled) removeDialog(dialog);
          alert = undefined;
          return false;
        }
        dialog.querySelector<HTMLButtonElement>('.alert-button-role-cancel')?.focus();
        const { role } = await dialog.onDidDismiss();
        alert = undefined;
        return valid() && role === 'confirm';
      } catch (failure) {
        if (alert) removeDialog(alert);
        alert = undefined;
        throw failure;
      }
    };

    return {
      present: () => {
        if (cancelled) return Promise.resolve(false);
        if (!result) {
          result = new Promise<boolean>((resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
          });
          void show().then(finish, (failure) => {
            rejectResult?.(failure);
            resolveResult = undefined;
            rejectResult = undefined;
          });
        }
        return result;
      },
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        clearFocus();
        trigger = null;
        finish(false);
        const dialog = alert;
        alert = undefined;
        if (dialog) {
          try {
            // Let Ionic restore accessibility and scrolling before detaching the overlay.
            // The confirmation result has already settled, even if teardown stays pending.
            void dialog.dismiss(undefined, 'cancel').then(
              () => removeDialog(dialog),
              () => removeDialog(dialog),
            );
          } catch {
            removeDialog(dialog);
          }
        }
      },
      restoreFocus: () => {
        clearFocus();
        if (!valid()) return;
        focusRef = afterNextRender(
          () => {
            focusRef = undefined;
            if (valid() && trigger instanceof HTMLElement && trigger.isConnected) {
              trigger.focus({ preventScroll: true });
            }
          },
          { injector: this.injector },
        );
      },
    };
  }
}
