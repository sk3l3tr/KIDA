import {
  ApplicationRef,
  ComponentRef,
  EnvironmentInjector,
  createComponent,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ModalController } from '@ionic/angular';
import { ArcaActionsService, ArcaModalService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { AppDialog } from './app-dialog';
import { APP_DIALOG_CANCEL, APP_DIALOG_OPEN, AppDialogResult } from './app-dialog.models';

describe('AppDialog with the installed ARCA modal and action implementations', () => {
  let component: ComponentRef<AppDialog> | undefined;
  let host: HTMLElement;
  let finishDismiss: (() => void) | undefined;
  let actions: ArcaActionsService;
  let modals: ArcaModalService;
  let close: () => Promise<boolean>;
  const config = {
    context: 'real-arca',
    title: 'Decisión',
    text: ['Un párrafo'],
    type: 'confirmation',
    buttons: [
      { id: 'cancel', text: 'Cancelar' },
      { id: 'confirm', text: 'Continuar' },
    ],
  };
  beforeEach(() => {
    close = vi.fn(async () => {
      host.dispatchEvent(new Event('ionModalWillDismiss'));
      finishDismiss?.();
      return true;
    });
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        {
          provide: ArcaService,
          useFactory: () => ({
            actions: inject(ArcaActionsService),
            modals: inject(ArcaModalService),
          }),
        },
        {
          provide: ModalController,
          useValue: {
            create: vi.fn(async () => {
              host = document.createElement('ion-modal');
              host.style.display = 'block';
              document.body.append(host);
              (host.shadowRoot ?? host.attachShadow({ mode: 'open' })).innerHTML = '<slot></slot>';
              component = createComponent(AppDialog, {
                environmentInjector: TestBed.inject(EnvironmentInjector),
              });
              TestBed.inject(ApplicationRef).attachView(component.hostView);
              host.append(component.location.nativeElement);
              component.changeDetectorRef.detectChanges();
              return {
                present: async () => {},
                onDidDismiss: () =>
                  new Promise<void>((resolve) => {
                    finishDismiss = resolve;
                  }),
              };
            }),
            dismiss: close,
          },
        },
      ],
    });
    actions = TestBed.inject(ArcaActionsService);
    modals = TestBed.inject(ArcaModalService);
  });
  afterEach(() => {
    if (component) {
      TestBed.inject(ApplicationRef).detachView(component.hostView);
      component.destroy();
      component = undefined;
    }
    host?.remove();
  });

  it.each(['confirm', 'cancel', 'external'])(
    'publishes exactly one explicit close action with context for %s',
    async (option) => {
      const results: AppDialogResult[] = [];
      const subscription = actions
        .listenAction('TEST_DIALOG_CLOSE')
        .subscribe((result) => results.push(result));
      await modals.openModal(AppDialog, config, APP_DIALOG_OPEN, 'TEST_DIALOG_CLOSE');
      component!.changeDetectorRef.detectChanges();
      expect(modals.modalOpen).toBe(true);
      expect(component!.location.nativeElement.textContent).toContain('Un párrafo');
      if (option === 'external') await close();
      else {
        component!.instance.choose(option);
        component!.instance.choose(option);
      }
      await Promise.resolve();
      expect(results).toEqual([
        { option: option === 'external' ? 'cancel' : option, data: { context: config.context } },
      ]);
      expect(modals.modalOpen).toBe(false);
      subscription.unsubscribe();
    },
  );

  it('closes an invalidated opening and ignores retained cancellation for a different context', async () => {
    actions.dispatchAction(APP_DIALOG_CANCEL, config.context);
    const results: unknown[] = [];
    const subscription = actions
      .listenAction('TEST_DIALOG_CLOSE')
      .subscribe((result) => results.push(result));
    await modals.openModal(AppDialog, config, APP_DIALOG_OPEN, 'TEST_DIALOG_CLOSE');
    await Promise.resolve();
    expect(results).toEqual([{ option: 'cancel', data: { context: config.context } }]);
    expect(modals.modalOpen).toBe(false);
    subscription.unsubscribe();
  });

  it('documents the ARCA creation failure without changing the vendored implementation', async () => {
    vi.mocked(TestBed.inject(ModalController).create).mockRejectedValueOnce(
      new Error('creation failed'),
    );
    await expect(
      modals.openModal(AppDialog, config, APP_DIALOG_OPEN, 'TEST_DIALOG_CLOSE'),
    ).rejects.toThrow('creation failed');
    expect(modals.modalOpen).toBe(true);
  });
});
