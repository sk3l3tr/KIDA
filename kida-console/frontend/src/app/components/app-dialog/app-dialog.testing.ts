import { TestBed } from '@angular/core/testing';
import { ApplicationRef, ComponentRef, EnvironmentInjector, createComponent } from '@angular/core';
import { ArcaActionsService, ArcaModalService } from 'arca';
import { vi } from 'vitest';
import { AppDialog } from './app-dialog';
import { AppDialogConfig } from './app-dialog.models';

/** Simulate Ionic presentation only; the component and ARCA action bus remain real. */
export function mockArcaDialogs() {
  const actions = TestBed.inject(ArcaActionsService);
  const modals = TestBed.inject(ArcaModalService);
  const application = TestBed.inject(ApplicationRef);
  let current:
    { component: ComponentRef<AppDialog>; host: HTMLElement; closeAction: string } | undefined;
  const close = vi.spyOn(modals, 'closeModal').mockImplementation((option, data) => {
    if (!current) return;
    modals.actionSentData = { option, data };
    dismiss();
  });
  function dismiss() {
    const active = current;
    if (!active) return;
    active.host.dispatchEvent(new Event('ionModalWillDismiss'));
    current = undefined;
    modals.modalOpen = false;
    actions.dispatchAction(active.closeAction, modals.actionSentData);
    modals.actionSentData = undefined;
    application.detachView(active.component.hostView);
    active.component.destroy();
    active.host.remove();
  }
  const open = vi
    .spyOn(modals, 'openModal')
    .mockImplementation((_component, config: AppDialogConfig, openAction, closeAction) => {
      if (modals.modalOpen) return Promise.resolve();
      modals.modalOpen = true;
      const host = document.createElement('ion-modal');
      // Ionic normally reveals the host during present(); no animation runs in this simulation.
      host.style.display = 'block';
      document.body.append(host);
      // Unpresented Ionic hosts have no rendered slot. Simulate the presented content tree.
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<slot></slot>';
      const component = createComponent(AppDialog, {
        environmentInjector: TestBed.inject(EnvironmentInjector),
      });
      application.attachView(component.hostView);
      host.append(component.location.nativeElement);
      current = { component, host, closeAction: closeAction! };
      component.changeDetectorRef.detectChanges();
      actions.dispatchAction(openAction!, config);
      component.changeDetectorRef.detectChanges();
      application.tick();
      return Promise.resolve();
    });
  return {
    open,
    close,
    get element(): HTMLElement | null {
      return current?.component.location.nativeElement ?? null;
    },
    get config(): AppDialogConfig | undefined {
      return open.mock.calls.at(-1)?.[1];
    },
    choose(option = 'confirm') {
      current?.component.location.nativeElement
        .querySelector(`[data-dialog-option="${option}"]`)
        ?.click();
    },
    dismiss,
  };
}
