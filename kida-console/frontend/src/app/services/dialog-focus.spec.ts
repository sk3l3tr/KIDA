import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { restoreDialogFocus } from './dialog-focus';

@Component({ template: '' })
class FocusHost {}

describe('Dialog focus helpers', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
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
