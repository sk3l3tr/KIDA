import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { trapDialogFocus, restoreDialogFocus } from './dialog-focus';

@Component({ template: '' })
class FocusHost {}

describe('Dialog focus helpers', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  function dialog() {
    const element = document.createElement('dialog');
    element.innerHTML = '<button>Cancel</button><button>Confirm</button>';
    // jsdom has no modal top layer; keyboard wrapping does not depend on it.
    element.open = true;
    document.body.append(element);
    return element;
  }

  it.each([false, true])('wraps Tab with shift=%s at the boundary', (shiftKey) => {
    const element = dialog();
    const [first, last] = element.querySelectorAll('button');
    (shiftKey ? first : last).focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
    trapDialogFocus(event, element, document);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(shiftKey ? last : first);
  });

  it('leaves interior Tab, other keys, and missing or empty dialogs untouched', () => {
    const element = dialog();
    const first = element.querySelector('button')!;
    first.focus();
    for (const [key, target] of [
      ['Tab', element],
      ['Escape', element],
      ['Tab', undefined],
      ['Tab', document.createElement('dialog')],
    ] as const) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      trapDialogFocus(event, target, document);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(first);
    }
  });

  it.each(['connected', 'removed', 'disabled', 'null'])(
    'restores focus for a %s trigger after rendering',
    async (state) => {
      const trigger = document.createElement('button');
      const heading = document.createElement('h2');
      heading.tabIndex = -1;
      document.body.append(trigger, heading);
      const fallback = vi.fn(() => heading);
      const fixture = TestBed.createComponent(FocusHost);
      const injector = fixture.componentRef.injector;
      restoreDialogFocus(injector, state === 'null' ? null : trigger, fallback, () => true);
      expect(document.activeElement).toBe(document.body);
      // State can change while Angular renders (for example after deletion).
      if (state === 'removed') trigger.remove();
      if (state === 'disabled') trigger.disabled = true;
      fixture.detectChanges();
      TestBed.tick();
      await fixture.whenStable();
      expect(document.activeElement).toBe(state === 'connected' ? trigger : heading);
      expect(fallback).toHaveBeenCalledTimes(state === 'connected' ? 0 : 1);
    },
  );

  it('ignores stale session/generation callbacks', async () => {
    const fixture = TestBed.createComponent(FocusHost);
    const fallback = vi.fn(() => undefined);
    let current = true;
    restoreDialogFocus(fixture.componentRef.injector, null, fallback, () => current);
    current = false;
    fixture.detectChanges();
    TestBed.tick();
    await fixture.whenStable();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('tolerates a missing trigger and fallback', async () => {
    const fixture = TestBed.createComponent(FocusHost);
    const fallback = vi.fn(() => undefined);
    restoreDialogFocus(fixture.componentRef.injector, null, fallback, () => true);
    fixture.detectChanges();
    TestBed.tick();
    await fixture.whenStable();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
