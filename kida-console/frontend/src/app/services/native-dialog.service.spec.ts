import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NativeDialogService } from './native-dialog.service';

@Component({ template: '' })
class DialogHost {}

describe('NativeDialogService', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  function setup() {
    const service = TestBed.inject(NativeDialogService);
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<button autofocus>Cancel</button><button>Confirm</button>';
    Object.defineProperties(dialog, {
      showModal: {
        value: vi.fn(() => {
          dialog.open = true;
        }),
      },
      close: {
        value: vi.fn(() => {
          dialog.open = false;
        }),
      },
    });
    document.body.append(dialog);
    return { service, dialog };
  }

  it('captures the trigger, opens with cancel focused and wraps keyboard focus', () => {
    const { service, dialog } = setup();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    expect(service.captureFocus()).toBe(trigger);
    service.open(dialog);
    expect(dialog.open).toBe(true);
    const [cancel, confirm] = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    service.trapFocus(event, dialog);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    service.close(dialog);
    service.close(dialog);
    service.close(undefined);
    expect(dialog.close).toHaveBeenCalledOnce();
  });

  it('reports missing dialogs and opening failures to the caller', () => {
    const { service, dialog } = setup();
    expect(() => service.open(undefined)).toThrow('Confirmation unavailable');
    const failure = new Error('Unavailable top layer');
    vi.mocked(dialog.showModal).mockImplementation(() => {
      throw failure;
    });
    expect(() => service.open(dialog)).toThrow(failure);
  });

  it.each(['connected', 'removed', 'disabled', 'stale'])(
    'restores focus after rendering with a %s trigger',
    async (state) => {
      const service = TestBed.inject(NativeDialogService);
      const fixture = TestBed.createComponent(DialogHost);
      const trigger = document.createElement('button');
      const heading = document.createElement('h2');
      heading.tabIndex = -1;
      document.body.append(trigger, heading);
      let current = true;
      service.restoreFocus(
        fixture.componentRef.injector,
        trigger,
        () => heading,
        () => current,
      );
      if (state === 'removed') trigger.remove();
      if (state === 'disabled') trigger.disabled = true;
      if (state === 'stale') current = false;
      fixture.detectChanges();
      TestBed.tick();
      await fixture.whenStable();
      expect(document.activeElement).toBe(
        state === 'stale' ? document.body : state === 'connected' ? trigger : heading,
      );
    },
  );

  it('keeps dialog ownership with each caller', () => {
    const first = setup();
    const second = setup();
    expect(first.service).toBe(second.service);
    first.service.open(first.dialog);
    second.service.open(second.dialog);
    first.service.close(first.dialog);
    expect(first.dialog.open).toBe(false);
    expect(second.dialog.open).toBe(true);
  });
});
