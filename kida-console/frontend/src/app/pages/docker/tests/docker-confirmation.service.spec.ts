import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DockerConfirmationService } from '../services/docker-confirmation.service';

@Component({ template: '', providers: [DockerConfirmationService] })
class ConfirmationHost {
  readonly confirmations = inject(DockerConfirmationService);
}

const pending = Object.freeze({
  action: 'delete' as const,
  id: 'full-container-id',
  name: '<img src=x>',
});

describe('DockerConfirmationService', () => {
  beforeEach(() => {
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  it('presents frozen identity as safe text and resolves acceptance once', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const session = fixture.componentInstance.confirmations.prepare(pending, () => true);
    const result = session.present();
    expect(session.present()).toBe(result);
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Acción: Eliminar');
    expect(dialog.textContent).toContain(pending.id);
    expect(dialog.textContent).toContain(pending.name);
    expect(dialog.querySelector('img')).toBeNull();
    dialog.querySelector<HTMLButtonElement>('button:last-child')!.click();
    dialog.querySelector<HTMLButtonElement>('button:last-child')!.click();
    expect(await result).toBe(true);
    expect(dialog.open).toBe(false);
  });
  it('settles cancellation before a deferred presentation and never opens it later', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const session = fixture.componentInstance.confirmations.prepare(pending, () => true, true);
    const result = session.present();
    session.cancel();
    expect(await result).toBe(false);
    TestBed.tick();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
  });
  it('does not let an old cancellation close or accept a newer session', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const service = fixture.componentInstance.confirmations;
    const previous = service.prepare(pending, () => true);
    const oldResult = previous.present();
    const current = service.prepare({ ...pending, id: 'new-id' }, () => true);
    const result = current.present();
    previous.cancel();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('new-id');
    dialog.querySelector<HTMLButtonElement>('button:last-child')!.click();
    expect(await oldResult).toBe(false);
    expect(await result).toBe(true);
  });
  it('rejects failed native opening and allows another session', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const service = fixture.componentInstance.confirmations;
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementationOnce(() => {
      throw new Error('open failed');
    });
    await expect(service.prepare(pending, () => true).present()).rejects.toThrow('open failed');
    const session = service.prepare(pending, () => true);
    const result = session.present();
    session.cancel();
    expect(await result).toBe(false);
  });

  it('cancels before presentation without opening and preserves the same result promise', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const session = fixture.componentInstance.confirmations.prepare(pending, () => true);
    session.cancel();
    const result = session.present();
    expect(session.present()).toBe(result);
    expect(await result).toBe(false);
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
  });
  it('rejects acceptance after its selection becomes obsolete', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    let current = true;
    const session = fixture.componentInstance.confirmations.prepare(pending, () => current);
    const result = session.present();
    current = false;
    fixture.nativeElement.querySelector('button:last-child').click();
    expect(await result).toBe(false);
  });
  it('settles pending presentation and removes its dialog on destruction', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const session = fixture.componentInstance.confirmations.prepare(pending, () => true);
    const result = session.present();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    fixture.destroy();
    expect(await result).toBe(false);
    expect(dialog.open).toBe(false);
    expect(dialog.isConnected).toBe(false);
  });

  it('clears the previous identity from the retained dialog on cancellation', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    const session = fixture.componentInstance.confirmations.prepare(pending, () => true);
    const result = session.present();
    session.cancel();
    expect(await result).toBe(false);
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.textContent).not.toContain(pending.id);
    expect(dialog.textContent).not.toContain(pending.name);
  });

  it('settles a deferred presentation when its context becomes obsolete without explicit cancellation', async () => {
    const fixture = TestBed.createComponent(ConfirmationHost);
    let current = true;
    const session = fixture.componentInstance.confirmations.prepare(pending, () => current, true);
    let accepted: boolean | null = null;
    void session.present().then((value) => (accepted = value));
    current = false;
    TestBed.tick();
    await Promise.resolve();
    expect(accepted).toBe(false);
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
  });
});
