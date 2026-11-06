import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ArcaActionsService, ArcaModalService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { AppDialog } from './app-dialog';
import { APP_DIALOG_CANCEL, APP_DIALOG_OPEN } from './app-dialog.models';

describe('AppDialog', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        {
          provide: ArcaService,
          useFactory: () => ({
            actions: TestBed.inject(ArcaActionsService),
            modals: TestBed.inject(ArcaModalService),
          }),
        },
      ],
    });
  });

  it('renders configurable paragraphs safely and returns the chosen button through ARCA', () => {
    const fixture = TestBed.createComponent(AppDialog);
    fixture.detectChanges();
    const close = vi.spyOn(TestBed.inject(ArcaModalService), 'closeModal');
    TestBed.inject(ArcaActionsService).dispatchAction(APP_DIALOG_OPEN, {
      context: 'test-1',
      title: 'Confirmar operación',
      text: ['Primer párrafo', '<img src=x>\nSegunda línea'],
      type: 'danger',
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        { id: 'confirm', text: 'Eliminar', icon: 'trash', style: 'danger' },
      ],
    });
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h2')?.textContent).toBe('Confirmar operación');
    expect([...element.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Primer párrafo',
      '<img src=x>\nSegunda línea',
    ]);
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.i-trash')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('button:last-child')!.click();
    element.querySelector<HTMLButtonElement>('button:last-child')!.click();
    expect(close).toHaveBeenCalledExactlyOnceWith('confirm', { context: 'test-1' });
  });

  it('honours cancellation before configuration arrives and ignores another context', () => {
    const fixture = TestBed.createComponent(AppDialog);
    fixture.detectChanges();
    const actions = TestBed.inject(ArcaActionsService);
    const close = vi.spyOn(TestBed.inject(ArcaModalService), 'closeModal');
    actions.dispatchAction(APP_DIALOG_CANCEL, 'old');
    actions.dispatchAction(APP_DIALOG_OPEN, {
      context: 'old',
      title: 'Cerrar',
      text: '',
      type: 'info',
      buttons: [],
    });
    expect(close).toHaveBeenCalledExactlyOnceWith('cancel', { context: 'old' });
    fixture.destroy();
    const next = TestBed.createComponent(AppDialog);
    next.detectChanges();
    actions.dispatchAction(APP_DIALOG_OPEN, {
      context: 'new',
      title: 'Actual',
      text: 'Texto',
      type: 'info',
      buttons: [],
    });
    expect(next.componentInstance.closing()).toBe(false);
  });

  it('reports an external Ionic dismissal as cancellation and cleans listeners', () => {
    const modal = document.createElement('ion-modal');
    document.body.append(modal);
    const fixture = TestBed.createComponent(AppDialog);
    modal.append(fixture.nativeElement);
    fixture.detectChanges();
    const arca = TestBed.inject(ArcaService);
    arca.actions.dispatchAction(APP_DIALOG_OPEN, {
      context: 'backdrop',
      title: 'Aviso',
      text: 'Texto',
      type: 'warning',
      buttons: [],
    });
    modal.dispatchEvent(new Event('ionModalWillDismiss'));
    expect(arca.modals.actionSentData).toEqual({ option: 'cancel', data: { context: 'backdrop' } });
    expect(fixture.componentInstance.closing()).toBe(true);
    fixture.destroy();
    expect(fixture.componentInstance.config()).toBeNull();
    modal.remove();
  });

  it('labels the Ionic shadow dialog with the configured title', () => {
    const modal = document.createElement('ion-modal');
    const shadow = modal.shadowRoot ?? modal.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div part="content" role="dialog"><slot></slot></div>';
    document.body.append(modal);
    const fixture = TestBed.createComponent(AppDialog);
    modal.append(fixture.nativeElement);
    fixture.detectChanges();
    TestBed.inject(ArcaActionsService).dispatchAction(APP_DIALOG_OPEN, {
      context: 'accessible',
      title: 'Confirmar eliminación',
      text: 'Texto',
      type: 'danger',
      buttons: [],
    });
    fixture.detectChanges();
    expect(shadow.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Confirmar eliminación',
    );
    fixture.destroy();
    modal.remove();
  });

  it('restores Cancel after Ionic presentation takes focus, and removes the listener on destruction', async () => {
    const modal = document.createElement('ion-modal');
    modal.tabIndex = -1;
    document.body.append(modal);
    const fixture = TestBed.createComponent(AppDialog);
    modal.append(fixture.nativeElement);
    fixture.detectChanges();
    TestBed.inject(ArcaActionsService).dispatchAction(APP_DIALOG_OPEN, {
      context: 'presented',
      title: 'Confirmar',
      text: '',
      type: 'confirmation',
      buttons: [
        { id: 'confirm', text: 'Continuar' },
        { id: 'cancel', text: 'Cancelar' },
      ],
    });
    fixture.detectChanges();
    modal.focus();
    expect(document.activeElement).toBe(modal);
    modal.dispatchEvent(new Event('ionModalDidPresent'));
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.textContent?.trim()).toBe('Cancelar');
    fixture.destroy();
    modal.focus();
    modal.dispatchEvent(new Event('ionModalDidPresent'));
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(modal);
    modal.remove();
  });

  it('focuses Cancel once its content has rendered, and cleans up on destruction', () => {
    const fixture = TestBed.createComponent(AppDialog);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    TestBed.inject(ArcaActionsService).dispatchAction(APP_DIALOG_OPEN, {
      context: 'focus',
      title: 'Confirmar',
      text: 'Texto',
      type: 'confirmation',
      buttons: [
        { id: 'confirm', text: 'Continuar' },
        { id: 'cancel', text: 'Cancelar' },
      ],
    });
    fixture.detectChanges();
    TestBed.tick();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancelar');
    fixture.destroy();
    TestBed.inject(ArcaActionsService).dispatchAction(APP_DIALOG_CANCEL, 'focus');
    expect(fixture.componentInstance.config()).toBeNull();
  });
});
