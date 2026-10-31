import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import { PendingAction } from '../utils/system.models';
import { SystemConfirmationService } from '../services/system-confirmation.service';

@Component({ template: '' })
class ConfirmationHost {}

const pending: PendingAction = Object.freeze({
  action: 'shutdown',
  body: Object.freeze({ when: '+1' }),
});

function dialog() {
  return {
    present: vi.fn().mockResolvedValue(undefined),
    onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
    dismiss: vi.fn().mockResolvedValue(true),
    remove: vi.fn(),
    querySelector: vi.fn(),
  };
}

describe('SystemConfirmationService', () => {
  let service: SystemConfirmationService;
  let alert: ReturnType<typeof dialog>;
  let create: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    alert = dialog();
    create = vi.fn().mockResolvedValue(alert);
    TestBed.configureTestingModule({
      imports: [ConfirmationHost],
      providers: [SystemConfirmationService, { provide: AlertController, useValue: { create } }],
    });
    TestBed.createComponent(ConfirmationHost).detectChanges();
    service = TestBed.inject(SystemConfirmationService);
  });

  it.each(['confirm', 'cancel', 'backdrop'])(
    'accepts only an explicit confirm role: %s',
    async (role) => {
      alert.onDidDismiss.mockResolvedValue({ role });
      const cancel = document.createElement('button');
      const focus = vi.spyOn(cancel, 'focus');
      alert.querySelector.mockReturnValue(cancel);
      expect(await service.prepare(pending, () => true).present()).toBe(role === 'confirm');
      expect(create).toHaveBeenCalledWith({
        header: 'Confirmar: Apagar',
        message:
          'Cuándo: +1. Horas locales del servidor. La operación puede desconectar el equipo.',
        cssClass: 'system-confirmation',
        backdropDismiss: false,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Confirmar', role: 'confirm' },
        ],
      });
      expect(alert.querySelector).toHaveBeenCalledWith('.alert-button-role-cancel');
      expect(focus).toHaveBeenCalledOnce();
    },
  );

  it('does not create a dialog for a cancelled or obsolete session', async () => {
    const cancelled = service.prepare(pending, () => true);
    cancelled.cancel();
    expect(await cancelled.present()).toBe(false);
    expect(await service.prepare(pending, () => false).present()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('reuses the same promise when cancelled before the first presentation', async () => {
    const confirmation = service.prepare(pending, () => true);
    confirmation.cancel();
    const result = confirmation.present();
    expect(confirmation.present()).toBe(result);
    confirmation.cancel();
    expect(confirmation.present()).toBe(result);
    expect(await result).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['create', 'present', 'onDidDismiss'] as const)(
    'reuses the same promise before and after cancellation during %s',
    async (stage) => {
      const operation = stage === 'create' ? create : alert[stage];
      operation.mockImplementationOnce(() => new Promise(() => {}));
      const confirmation = service.prepare(pending, () => true);
      const result = confirmation.present();
      expect(confirmation.present()).toBe(result);
      await Promise.resolve();
      await Promise.resolve();
      expect(operation).toHaveBeenCalledOnce();
      confirmation.cancel();
      expect(confirmation.present()).toBe(result);
      expect(await result).toBe(false);
      confirmation.cancel();
      expect(confirmation.present()).toBe(result);
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it('preserves the promise and its accepted result when cancelled after completion', async () => {
    const confirmation = service.prepare(pending, () => true);
    const result = confirmation.present();
    expect(await result).toBe(true);
    expect(confirmation.present()).toBe(result);
    confirmation.cancel();
    expect(confirmation.present()).toBe(result);
    expect(await result).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(alert.dismiss).not.toHaveBeenCalled();
  });

  it.each<{ action: PendingAction; header: string; summary: string }>([
    {
      action: { action: 'shutdown', body: { when: 'now' } },
      header: 'Apagar',
      summary: 'Cuándo: now.',
    },
    {
      action: { action: 'reboot', body: { when: '23:00' } },
      header: 'Reiniciar',
      summary: 'Cuándo: 23:00.',
    },
    {
      action: { action: 'powerCycle', body: { wake_time: '06:00' } },
      header: 'Ciclo de energía',
      summary: 'Encendido a las 06:00; apagado: +1.',
    },
    {
      action: { action: 'powerCycle', body: { wake_time: '06:00', shutdown_time: '23:00' } },
      header: 'Ciclo de energía',
      summary: 'Encendido a las 06:00; apagado: 23:00.',
    },
    {
      action: { action: 'powerCycle', body: { wake_after_seconds: 120 } },
      header: 'Ciclo de energía',
      summary: 'Encendido en 120 segundos; apagado: +1.',
    },
    {
      action: { action: 'powerCycle', body: { wake_after_seconds: 3600, shutdown_time: '23:00' } },
      header: 'Ciclo de energía',
      summary: 'Encendido en 3600 segundos; apagado: 23:00.',
    },
  ])('preserves the confirmation message: $summary', async ({ action, header, summary }) => {
    await service.prepare(action, () => true).present();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: `Confirmar: ${header}`,
        message: `${summary} Horas locales del servidor. La operación puede desconectar el equipo.`,
      }),
    );
  });

  it('removes a late-created cancelled dialog without changing a newer session', async () => {
    const oldDialog = dialog();
    let resolve!: (value: typeof oldDialog) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const old = service.prepare(pending, () => true);
    const presented = old.present();
    old.cancel();
    const current = service.prepare(pending, () => true);
    expect(await current.present()).toBe(true);
    resolve(oldDialog);
    expect(await presented).toBe(false);
    expect(oldDialog.remove).toHaveBeenCalledOnce();
    expect(oldDialog.present).not.toHaveBeenCalled();
    expect(alert.remove).not.toHaveBeenCalled();
    expect(alert.dismiss).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'invalidate'])(
    'discards a dialog invalidated during presentation: %s',
    async (mode) => {
      let finishPresent!: () => void;
      alert.present.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishPresent = resolve;
          }),
      );
      let current = true;
      const confirmation = service.prepare(pending, () => current);
      const presented = confirmation.present();
      await Promise.resolve();
      if (mode === 'cancel') confirmation.cancel();
      else current = false;
      finishPresent();
      expect(await presented).toBe(false);
      expect(alert.remove).toHaveBeenCalledOnce();
      expect(alert.querySelector).not.toHaveBeenCalled();
      expect(alert.onDidDismiss).not.toHaveBeenCalled();
      if (mode === 'cancel') expect(alert.dismiss).toHaveBeenCalledWith(undefined, 'cancel');
    },
  );

  it('rejects a stale acceptance after dismissal', async () => {
    let current = true;
    alert.onDidDismiss.mockImplementationOnce(async () => {
      current = false;
      return { role: 'confirm' };
    });
    expect(await service.prepare(pending, () => current).present()).toBe(false);
  });

  it.each(['create', 'present', 'onDidDismiss'] as const)(
    'propagates %s failures and removes its own dialog',
    async (stage) => {
      const failure = new Error('dialog failed');
      (stage === 'create' ? create : alert[stage]).mockRejectedValueOnce(failure);
      await expect(service.prepare(pending, () => true).present()).rejects.toBe(failure);
      expect(alert.remove).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
    },
  );

  it.each(['create', 'present'] as const)(
    'handles a late %s rejection after cancellation',
    async (stage) => {
      let reject!: (failure: Error) => void;
      const operation = stage === 'create' ? create : alert.present;
      operation.mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      const confirmation = service.prepare(pending, () => true);
      const result = confirmation.present();
      await Promise.resolve();
      expect(operation).toHaveBeenCalledOnce();
      confirmation.cancel();
      expect(await result).toBe(false);
      reject(new Error('late failure'));
      await Promise.resolve();
      await Promise.resolve();
      expect(confirmation.present()).toBe(result);
      expect(await result).toBe(false);
      expect(alert.remove).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
      expect(alert.dismiss).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
      expect(alert.onDidDismiss).not.toHaveBeenCalled();
    },
  );

  it('waits for Ionic teardown when presentation rejects after cancellation', async () => {
    let rejectPresent!: (failure: Error) => void;
    let finishDismiss!: (dismissed: boolean) => void;
    alert.present.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectPresent = reject;
        }),
    );
    alert.dismiss.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishDismiss = resolve;
        }),
    );
    const confirmation = service.prepare(pending, () => true);
    const result = confirmation.present();
    await Promise.resolve();
    confirmation.cancel();
    expect(await result).toBe(false);
    rejectPresent(new Error('late presentation failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(alert.remove).not.toHaveBeenCalled();
    finishDismiss(true);
    await Promise.resolve();
    expect(alert.remove).toHaveBeenCalledOnce();
    expect(alert.dismiss).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'false', 'true', 'pending', 'throw'] as const)(
    'settles cancellation without onDidDismiss when dismiss is %s',
    async (outcome) => {
      alert.onDidDismiss.mockImplementationOnce(() => new Promise(() => {}));
      if (outcome === 'reject') alert.dismiss.mockRejectedValueOnce(new Error('dismiss failed'));
      if (outcome === 'false') alert.dismiss.mockResolvedValueOnce(false);
      if (outcome === 'pending') alert.dismiss.mockImplementationOnce(() => new Promise(() => {}));
      if (outcome === 'throw')
        alert.dismiss.mockImplementationOnce(() => {
          throw new Error('dismiss failed');
        });
      const confirmation = service.prepare(pending, () => true);
      const presented = confirmation.present();
      await Promise.resolve();
      await Promise.resolve();
      expect(alert.onDidDismiss).toHaveBeenCalledOnce();
      confirmation.cancel();
      confirmation.cancel();
      expect(await presented).toBe(false);
      expect(await confirmation.present()).toBe(false);
      expect(alert.dismiss).toHaveBeenCalledOnce();
      if (outcome === 'pending') expect(alert.remove).not.toHaveBeenCalled();
      else expect(alert.remove).toHaveBeenCalledOnce();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores a late dismissal %s after cancellation',
    async (outcome) => {
      let resolve!: (value: { role: string }) => void;
      let reject!: (reason: Error) => void;
      alert.onDidDismiss.mockImplementationOnce(
        () =>
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      );
      const confirmation = service.prepare(pending, () => true);
      const presented = confirmation.present();
      await Promise.resolve();
      await Promise.resolve();
      confirmation.cancel();
      expect(await presented).toBe(false);
      if (outcome === 'resolve') resolve({ role: 'confirm' });
      else reject(new Error('late failure'));
      await Promise.resolve();
      await Promise.resolve();
      expect(await presented).toBe(false);
      expect(alert.remove).toHaveBeenCalledOnce();
      expect(alert.dismiss).toHaveBeenCalledOnce();
    },
  );

  it('settles cancellation before create resolves and removes its late dialog once', async () => {
    let resolve!: (value: typeof alert) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const confirmation = service.prepare(pending, () => true);
    const presented = confirmation.present();
    confirmation.cancel();
    confirmation.cancel();
    expect(await presented).toBe(false);
    resolve(alert);
    await Promise.resolve();
    expect(alert.remove).toHaveBeenCalledOnce();
    expect(alert.present).not.toHaveBeenCalled();
    expect(alert.dismiss).not.toHaveBeenCalled();
  });

  it('settles cancellation before present resolves and ignores its late completion', async () => {
    let resolve!: () => void;
    alert.present.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const confirmation = service.prepare(pending, () => true);
    const presented = confirmation.present();
    await Promise.resolve();
    confirmation.cancel();
    confirmation.cancel();
    expect(await presented).toBe(false);
    resolve();
    await Promise.resolve();
    expect(alert.remove).toHaveBeenCalledOnce();
    expect(alert.querySelector).not.toHaveBeenCalled();
    expect(alert.onDidDismiss).not.toHaveBeenCalled();
  });

  it('lets Ionic finish dismissal before detaching a cancelled presenting dialog', async () => {
    let finishPresent!: () => void;
    let finishDismiss!: (dismissed: boolean) => void;
    alert.present.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPresent = resolve;
        }),
    );
    alert.dismiss.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishDismiss = resolve;
        }),
    );
    const confirmation = service.prepare(pending, () => true);
    const presented = confirmation.present();
    await Promise.resolve();
    confirmation.cancel();
    expect(await presented).toBe(false);
    finishPresent();
    await Promise.resolve();
    expect(alert.remove).not.toHaveBeenCalled();
    expect(alert.querySelector).not.toHaveBeenCalled();
    finishDismiss(true);
    await Promise.resolve();
    expect(alert.remove).toHaveBeenCalledOnce();
  });

  it('replaces deferred focus rather than registering duplicate callbacks', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    try {
      trigger.focus();
      const focus = vi.spyOn(trigger, 'focus');
      const confirmation = service.prepare(pending, () => true);
      confirmation.restoreFocus();
      confirmation.restoreFocus();
      TestBed.tick();
      expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      confirmation.restoreFocus();
      confirmation.cancel();
      confirmation.restoreFocus();
      TestBed.tick();
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      trigger.remove();
    }
  });

  it.each(['confirm', 'cancel'])(
    'cancels deferred focus after a completed dialog with role %s',
    async (role) => {
      const trigger = document.createElement('button');
      document.body.append(trigger);
      try {
        trigger.focus();
        const focus = vi.spyOn(trigger, 'focus');
        alert.onDidDismiss.mockResolvedValueOnce({ role });
        const confirmation = service.prepare(pending, () => true);
        await confirmation.present();
        confirmation.restoreFocus();
        TestBed.tick();
        expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
        confirmation.restoreFocus();
        confirmation.cancel();
        TestBed.tick();
        expect(focus).toHaveBeenCalledOnce();
        expect(alert.dismiss).not.toHaveBeenCalled();
      } finally {
        trigger.remove();
      }
    },
  );

  it.each(['valid', 'obsolete', 'cancelled', 'disconnected'] as const)(
    'restores focus only to a current connected trigger: %s',
    (mode) => {
      const trigger = document.createElement('button');
      document.body.append(trigger);
      try {
        trigger.focus();
        const focus = vi.spyOn(trigger, 'focus');
        let current = true;
        const confirmation = service.prepare(pending, () => current);
        confirmation.restoreFocus();
        expect(focus).not.toHaveBeenCalled();
        if (mode === 'obsolete') current = false;
        if (mode === 'cancelled') confirmation.cancel();
        if (mode === 'disconnected') trigger.remove();
        TestBed.tick();
        if (mode === 'valid') expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        else expect(focus).not.toHaveBeenCalled();
      } finally {
        trigger.remove();
      }
    },
  );
});
