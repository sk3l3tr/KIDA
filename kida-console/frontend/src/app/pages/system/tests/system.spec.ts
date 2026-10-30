import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { ArcaRequestService } from '../../../services/arca-request.service';
import { SystemService } from '../services/system.service';
import { SystemFacade } from '../services/system.facade';
import { SystemConfirmationService } from '../services/system-confirmation.service';
import { SystemOverview } from '../tabs/system-overview/system-overview';
import { SystemEnergy } from '../tabs/system-energy/system-energy';
import { SystemInspector } from '../tabs/system-inspector/system-inspector';

@Component({
  imports: [SystemOverview, SystemEnergy, SystemInspector],
  template: '<app-system-overview /><app-system-energy /><app-system-inspector />',
})
class SystemHarness {
  readonly state = inject(SystemFacade);
}
import { cycleRequest, systemFailure, validWhen } from '../utils/system.models';
import { systemActions } from '../utils/system.actions';

const base = `${environment.apiBaseUrl}/system`;
const info = {
  hostname: null,
  os: { name: 'Linux', version: null },
  memory: { total_bytes: 1024 ** 3 },
  graphics: [],
  disks: [],
  future: { extra: 'visible' },
};
const health = { overall: 'unknown', sensors: [], future: { extra: 'visible' } };
const wake = {
  rtc_device: null,
  rtcwake_available: true,
  rtc_alarm_available: null,
  s5_wake_status: 'unverified',
  warnings: [],
};

function setup() {
  TestBed.configureTestingModule({
    imports: [SystemHarness],
    providers: [
      ...appConfig.providers,
      SystemFacade,
      SystemConfirmationService,
      provideHttpClientTesting(),
      {
        provide: ArcaService,
        useFactory: () => ({
          actions: inject(ArcaActionsService),
          panels: inject(ArcaPanelsService),
        }),
      },
      { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return TestBed.inject(HttpTestingController);
}

describe('System requests and shared ARCA adapter', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());

  it('registers six distinct channels', () => {
    expect(systemActions).toHaveLength(6);
    expect(new Set(systemActions.map((a) => a.actionName)).size).toBe(6);
  });

  it('sends the three GET routes independently, preserving nulls, empty lists and new fields', () => {
    const service = TestBed.inject(SystemService);
    const first = vi.fn(),
      second = vi.fn(),
      third = vi.fn();
    service.info().subscribe(first);
    service.health().subscribe(second);
    service.wakeCapabilities().subscribe(third);
    const requests = ['info', 'health', 'wake-capabilities'].map((path) =>
      http.expectOne(`${base}/${path}`),
    );
    for (const r of requests) {
      expect(r.request.method).toBe('GET');
      expect(r.request.withCredentials).toBe(true);
    }
    requests[1].flush(health);
    expect(second).toHaveBeenCalledWith(health);
    expect(first).not.toHaveBeenCalled();
    requests[0].flush(info);
    requests[2].flush(wake);
    expect(first).toHaveBeenCalledWith(info);
    expect(third).toHaveBeenCalledWith(wake);
  });
  it('sends the three POST routes with their exact bodies and no retry', () => {
    const service = TestBed.inject(SystemService);
    for (const action of ['shutdown', 'reboot'] as const) {
      service.execute({ action, body: { when: '+1' } }).subscribe();
      const r = http.expectOne(`${base}/${action}`);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ when: '+1' });
      r.flush({ scheduled: true, when: '+1' });
    }
    for (const body of [
      { wake_time: '06:00', shutdown_time: '23:00' },
      { wake_after_seconds: 120 },
    ]) {
      const error = vi.fn();
      service.execute({ action: 'powerCycle', body }).subscribe({ error });
      const r = http.expectOne(`${base}/power-cycle`);
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual(body);
      r.flush({ detail: { code: 'core_timeout' } }, { status: 504, statusText: 'Timeout' });
      expect(error).toHaveBeenCalledOnce();
      http.expectNone(`${base}/power-cycle`);
    }
  });

  it('preserves successful null HTTP responses in the extracted adapter', () => {
    const next = vi.fn();
    TestBed.inject(ArcaRequestService).request<void>('LOGOUT').subscribe(next);
    http
      .expectOne(`${environment.apiBaseUrl}/auth/logout`)
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('System validation and failures', () => {
  it.each(['now', '+1', '+0', '+120', '23:59', '1:2'])('accepts power time %s', (value) =>
    expect(validWhen(value)).toBe(true),
  );
  it.each(['', 'NOW', '-1', '24:00', '12:60', 'now\n', ' 12:00', '+1.2'])(
    'rejects power time %s',
    (value) => expect(validWhen(value)).toBe(false),
  );
  it('selects exactly one wake mode and omits unused optional fields', () => {
    expect(cycleRequest('time', '06:00', '500', '')).toEqual({ wake_time: '06:00' });
    expect(cycleRequest('seconds', '06:00', '120', '23:00')).toEqual({
      wake_after_seconds: 120,
      shutdown_time: '23:00',
    });
    for (const seconds of ['119', '-120', '120.5', '1e3', '9007199254740992', ''])
      expect(cycleRequest('seconds', '', seconds, '')).toBeNull();
    for (const clock of ['6:00', '24:00', '06:60', '06:00\n'])
      expect(cycleRequest('time', clock, '', '')).toBeNull();
    expect(cycleRequest('time', '06:00', '', '25:00')).toBeNull();
  });
  it('distinguishes uncertain execution, unavailable CORE and confirmed rejection', () => {
    const failure = (status: number, code: string) =>
      new HttpErrorResponse({ status, error: { detail: { code, message: 'reason' } } });
    for (const code of [
      'core_timeout',
      'core_transport_error',
      'core_http_error',
      'core_invalid_response',
    ])
      expect(systemFailure(failure(502, code), true)).toContain('incierta');
    expect(systemFailure(failure(0, ''), true)).toContain('incierta');
    expect(systemFailure(failure(503, 'core_unavailable'), true)).toContain('Sin conexión');
    expect(systemFailure(failure(502, 'core_error'), true)).toBe('Error: reason');
    expect(systemFailure(failure(0, ''))).toContain('Sin conexión');
    expect(systemFailure(failure(422, ''), true)).toContain('rechazados');
  });
});

describe('System page', () => {
  let http: HttpTestingController;
  let dismiss: (value: { role: string }) => void;
  let dialog: {
    present: ReturnType<typeof vi.fn>;
    onDidDismiss: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    querySelector: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    http = setup();
    dialog = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn(
        () =>
          new Promise((resolve) => {
            dismiss = resolve;
          }),
      ),
      dismiss: vi.fn().mockResolvedValue(true),
      remove: vi.fn(),
      querySelector: vi.fn(),
    };
    vi.spyOn(TestBed.inject(AlertController), 'create').mockResolvedValue(dialog as never);
  });
  afterEach(() => http.verify());
  function enter() {
    const fixture = TestBed.createComponent(SystemHarness);
    fixture.componentInstance.state.ionViewWillEnter();
    fixture.componentInstance.state.enterEnergy();
    http.expectNone(`${base}/info`);
    http.expectOne(`${base}/health`).flush(health);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    fixture.detectChanges();
    return fixture;
  }
  async function ready() {
    await Promise.resolve();
    await Promise.resolve();
  }
  it('places the three energy panels in masonry', () => {
    const fixture = enter();
    const masonry = fixture.nativeElement.querySelector('app-system-energy app-masonry');
    const items = () => masonry.querySelectorAll(':scope > [appMasonryItem]');
    expect([...items()].map((item: Element) => item.getAttribute('aria-label'))).toEqual([
      'Capacidades RTC',
      'Apagado y reinicio',
      'Ciclo de energía',
    ]);
  });
  it('updates quick choices and manual input without sending an operation', async () => {
    const fixture = enter();
    const card: HTMLElement = fixture.nativeElement.querySelector('app-system-power-card');
    const input = card.querySelector<HTMLInputElement>('#power-when')!;
    const choices = Array.from(card.querySelectorAll<HTMLButtonElement>('.quick-action'));
    const actions = card.querySelectorAll<HTMLButtonElement>('.power-buttons button');
    expect(choices.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    for (const [index, value] of ['now', '+1', '+30'].entries()) {
      choices[index].click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.state.when).toBe(value);
      expect(choices.map((button) => button.getAttribute('aria-pressed'))).toEqual(
        choices.map((_, choice) => String(choice === index)),
      );
    }
    input.value = '23:45';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.state.when).toBe('23:45');
    expect(choices.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    input.value = 'invalid';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(card.textContent).toContain('Introduce now');
    expect(Array.from(actions).every((button) => button.disabled)).toBe(true);
    http.expectNone(`${base}/shutdown`);
    http.expectNone(`${base}/reboot`);
    expect(TestBed.inject(AlertController).create).not.toHaveBeenCalled();
  });
  it.each(['shutdown', 'reboot'] as const)(
    'confirms %s from the card with frozen parameters',
    async (action) => {
      const fixture = enter();
      const confirmation = vi.spyOn(fixture.componentInstance.state, 'confirm');
      const card: HTMLElement = fixture.nativeElement.querySelector('app-system-power-card');
      const buttons = card.querySelectorAll<HTMLButtonElement>('.power-buttons button');
      const form = card.querySelector<HTMLFormElement>('form')!;
      if (action === 'shutdown')
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      else buttons[1].click();
      await ready();
      fixture.detectChanges();
      expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
      card.querySelector<HTMLButtonElement>('.quick-action')!.click();
      dismiss({ role: 'confirm' });
      await confirmation.mock.results[0].value;
      const request = http.expectOne(`${base}/${action}`);
      expect(request.request.body).toEqual({ when: '+1' });
      request.flush({ scheduled: true, when: '+1' });
    },
  );
  it('rejects invalid parameters and confirmations outside Energy without a dialog', async () => {
    const view = enter().componentInstance.state;
    view.when = 'invalid';
    await view.confirm('shutdown');
    view.wakeTime = 'invalid';
    await view.confirm('powerCycle');
    view.when = '+1';
    view.leaveEnergy();
    await view.confirm('reboot');
    view.ionViewWillLeave();
    view.enterEnergy();
    await view.confirm('shutdown');
    expect(TestBed.inject(AlertController).create).not.toHaveBeenCalled();
    expect(view.busy()).toBe(false);
    http.expectNone((request) => request.method === 'POST');
  });

  it.each(['time', 'seconds'])('freezes the %s power-cycle payload and summary', async (mode) => {
    const view = enter().componentInstance.state;
    const execute = vi.spyOn(TestBed.inject(SystemService), 'execute');
    view.wakeMode = mode;
    view.wakeTime = '08:30';
    view.wakeSeconds = '240';
    view.shutdownTime = '23:00';
    const operation = view.confirm('powerCycle');
    await ready();
    view.wakeTime = '09:00';
    view.wakeSeconds = '360';
    view.shutdownTime = '';
    expect(TestBed.inject(AlertController).create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(mode === 'time' ? '08:30' : '240 segundos'),
      }),
    );
    dismiss({ role: 'confirm' });
    await operation;
    const pending = execute.mock.calls[0][0];
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(pending.body)).toBe(true);
    const request = http.expectOne(`${base}/power-cycle`);
    expect(request.request.body).toEqual({
      ...(mode === 'time' ? { wake_time: '08:30' } : { wake_after_seconds: 240 }),
      shutdown_time: '23:00',
    });
    request.flush({ shutdown_scheduled: true });
    expect(view.busy()).toBe(false);
  });

  it.each(['create', 'present'] as const)(
    'releases the lock after a dialog %s failure and allows retry',
    async (stage) => {
      const view = enter().componentInstance.state;
      const failure = new Error('dialog failed');
      if (stage === 'create')
        vi.mocked(TestBed.inject(AlertController).create).mockRejectedValueOnce(failure);
      else dialog.present.mockRejectedValueOnce(failure);
      await view.confirm('shutdown');
      expect(view.busy()).toBe(false);
      http.expectNone(`${base}/shutdown`);
      const retry = view.confirm('shutdown');
      await ready();
      expect(view.busy()).toBe(true);
      dismiss({ role: 'cancel' });
      await retry;
      expect(view.busy()).toBe(false);
    },
  );

  it('handles synchronous preparation failures and allows retry', async () => {
    const view = enter().componentInstance.state;
    vi.spyOn(TestBed.inject(SystemConfirmationService), 'prepare').mockImplementationOnce(() => {
      throw new Error('prepare failed');
    });
    await expect(view.confirm('shutdown')).resolves.toBeUndefined();
    expect(view.busy()).toBe(false);
    expect(TestBed.inject(AlertController).create).not.toHaveBeenCalled();
    http.expectNone(`${base}/shutdown`);
    const retry = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await retry;
    http.expectOne(`${base}/reboot`).flush({ scheduled: true, when: '+1' });
    expect(view.busy()).toBe(false);
  });

  it('releases the lock after a synchronous execution failure and allows retry', async () => {
    const view = enter().componentInstance.state;
    vi.spyOn(TestBed.inject(SystemService), 'execute').mockImplementationOnce(() => {
      throw new Error('execution failed');
    });
    const operation = view.confirm('shutdown');
    await ready();
    dismiss({ role: 'confirm' });
    await operation;
    expect(view.busy()).toBe(false);
    http.expectNone(`${base}/shutdown`);
    const retry = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await retry;
    http.expectOne(`${base}/reboot`).flush({ scheduled: true, when: '+1' });
    expect(view.busy()).toBe(false);
  });

  it.each(['tab', 'view', 'session', 'destroy'] as const)(
    'invalidates the confirmation before cancelling it on %s',
    async (leaving) => {
      const view = enter().componentInstance.state;
      const prepare = vi.spyOn(TestBed.inject(SystemConfirmationService), 'prepare');
      const operation = view.confirm('shutdown');
      await ready();
      const isCurrent = prepare.mock.calls[0][1];
      const confirmation = prepare.mock.results[0].value;
      const cancel = confirmation.cancel.bind(confirmation);
      const cancellation = vi.spyOn(confirmation, 'cancel').mockImplementation(() => {
        expect(isCurrent()).toBe(false);
        cancel();
      });
      expect(isCurrent()).toBe(true);

      if (leaving === 'tab') view.leaveEnergy();
      else if (leaving === 'view') view.ionViewWillLeave();
      else if (leaving === 'session') TestBed.inject(ThemeIdentity).clear();
      else view.ngOnDestroy();

      expect(cancellation).toHaveBeenCalledOnce();
      await operation;
      expect(view.busy()).toBe(false);
      http.expectNone((request) => request.method === 'POST');
    },
  );

  it.each(['tab', 'view', 'session'] as const)(
    'releases a pending creation on %s invalidation without unlocking a newer dialog',
    async (leaving) => {
      const view = enter().componentInstance.state;
      let resolveOld!: (alert: HTMLIonAlertElement) => void;
      const oldDialog = { ...dialog, remove: vi.fn() };
      vi.mocked(TestBed.inject(AlertController).create).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      );
      const old = view.confirm('shutdown');
      expect(view.busy()).toBe(true);
      if (leaving === 'tab') view.leaveEnergy();
      else if (leaving === 'view') view.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      // Cleanup is immediate, even though the old create() is still unresolved.
      expect(view.busy()).toBe(false);
      if (leaving !== 'tab') {
        view.ionViewWillEnter();
        http.expectOne(`${base}/health`).flush(health);
        http.expectOne(`${base}/wake-capabilities`).flush(wake);
      }
      view.enterEnergy();
      const current = view.confirm('reboot');
      await ready();
      resolveOld(oldDialog as unknown as HTMLIonAlertElement);
      await old;
      expect(oldDialog.remove).toHaveBeenCalledOnce();
      expect(view.busy()).toBe(true);
      await view.confirm('shutdown');
      expect(TestBed.inject(AlertController).create).toHaveBeenCalledTimes(2);
      dismiss({ role: 'cancel' });
      await current;
      expect(view.busy()).toBe(false);
      http.expectNone((request) => request.method === 'POST');
    },
  );

  it.each(['tab', 'view', 'session'] as const)(
    'does not let an old dismissal unlock or execute over a new confirmation after %s invalidation',
    async (leaving) => {
      const view = enter().componentInstance.state;
      const old = view.confirm('shutdown');
      await ready();
      const dismissOld = dismiss;
      if (leaving === 'tab') view.leaveEnergy();
      else if (leaving === 'view') view.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      if (leaving !== 'tab') {
        view.ionViewWillEnter();
        http.expectOne(`${base}/health`).flush(health);
        http.expectOne(`${base}/wake-capabilities`).flush(wake);
      }
      view.enterEnergy();
      const current = view.confirm('reboot');
      await ready();
      dismissOld({ role: 'confirm' });
      await old;
      expect(view.busy()).toBe(true);
      await view.confirm('shutdown');
      expect(TestBed.inject(AlertController).create).toHaveBeenCalledTimes(2);
      http.expectNone(`${base}/shutdown`);
      dismiss({ role: 'confirm' });
      await current;
      http.expectOne(`${base}/reboot`).flush({ scheduled: true, when: '+1' });
      expect(view.busy()).toBe(false);
    },
  );

  it.each(['tab', 'view', 'session'] as const)(
    'releases the confirmation lock when leaving between dismissal and execution after %s invalidation',
    async (leaving) => {
      const view = enter().componentInstance.state;
      const operation = view.confirm('shutdown');
      await ready();
      dismiss({ role: 'confirm' });
      queueMicrotask(() => {
        if (leaving === 'tab') view.leaveEnergy();
        else if (leaving === 'view') view.ionViewWillLeave();
        else TestBed.inject(ThemeIdentity).clear();
        if (leaving !== 'tab') {
          view.ionViewWillEnter();
          http.expectOne(`${base}/health`).flush(health);
          http.expectOne(`${base}/wake-capabilities`).flush(wake);
        }
        view.enterEnergy();
      });
      await operation;
      expect(view.busy()).toBe(false);
      http.expectNone(`${base}/shutdown`);
      const retry = view.confirm('reboot');
      await ready();
      dismiss({ role: 'cancel' });
      await retry;
      expect(TestBed.inject(AlertController).create).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['tab', 'view', 'session'] as const)(
    'does not let an old dialog creation failure affect a new confirmation after %s invalidation',
    async (leaving) => {
      const view = enter().componentInstance.state;
      let rejectOld!: (reason: Error) => void;
      vi.mocked(TestBed.inject(AlertController).create).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject;
          }),
      );
      const old = view.confirm('shutdown');
      if (leaving === 'tab') view.leaveEnergy();
      else if (leaving === 'view') view.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      if (leaving !== 'tab') {
        view.ionViewWillEnter();
        http.expectOne(`${base}/health`).flush(health);
        http.expectOne(`${base}/wake-capabilities`).flush(wake);
      }
      view.enterEnergy();
      const current = view.confirm('reboot');
      await ready();
      rejectOld(new Error('late failure'));
      await old;
      expect(view.busy()).toBe(true);
      dismiss({ role: 'cancel' });
      await current;
      expect(view.busy()).toBe(false);
      http.expectNone((request) => request.method === 'POST');
    },
  );

  it.each(['cancel', 'success', 'failure', 'start-failure'] as const)(
    'restores focus after %s',
    async (outcome) => {
      const fixture = enter();
      const view = fixture.componentInstance.state;
      const trigger = document.createElement('button');
      document.body.append(trigger);
      const cancelButton = document.createElement('button');
      const cancelFocus = vi.spyOn(cancelButton, 'focus');
      dialog.querySelector.mockReturnValue(cancelButton);
      try {
        trigger.focus();
        const focus = vi.spyOn(trigger, 'focus');
        if (outcome === 'start-failure') {
          vi.spyOn(TestBed.inject(SystemService), 'execute').mockImplementationOnce(() => {
            throw new Error('execution failed');
          });
        }
        const operation = view.confirm('shutdown');
        await ready();
        expect(cancelFocus).toHaveBeenCalled();
        dismiss({ role: outcome === 'cancel' ? 'cancel' : 'confirm' });
        await operation;
        if (outcome !== 'cancel' && outcome !== 'start-failure') {
          const request = http.expectOne(`${base}/shutdown`);
          if (outcome === 'success') request.flush({ scheduled: true, when: '+1' });
          else request.error(new ProgressEvent('error'));
        }
        TestBed.tick();
        expect(view.busy()).toBe(false);
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      } finally {
        trigger.remove();
      }
    },
  );

  it('does not restore focus after leaving and returning to Energy', async () => {
    const fixture = enter();
    const view = fixture.componentInstance.state;
    const prepare = vi.spyOn(TestBed.inject(SystemConfirmationService), 'prepare');
    const trigger = document.createElement('button');
    document.body.append(trigger);
    try {
      trigger.focus();
      const focus = vi.spyOn(trigger, 'focus');
      const operation = view.confirm('shutdown');
      await ready();
      const confirmation = prepare.mock.results[0].value;
      const restoreFocus = confirmation.restoreFocus.bind(confirmation);
      vi.spyOn(confirmation, 'restoreFocus').mockImplementationOnce(() => {
        restoreFocus();
        // Invalidate after registration, before Angular can run the deferred focus.
        view.leaveEnergy();
        view.enterEnergy();
      });
      dismiss({ role: 'cancel' });
      await operation;
      TestBed.tick();
      expect(focus).not.toHaveBeenCalled();
    } finally {
      trigger.remove();
    }
  });

  it('cancels without sending an action and freezes confirmed parameters, blocking duplicates', async () => {
    const view = enter().componentInstance.state;
    const cancel = view.confirm('shutdown');
    await ready();
    dismiss({ role: 'cancel' });
    await cancel;
    http.expectNone(`${base}/shutdown`);
    expect(view.busy()).toBe(false);
    const confirmed = view.confirm('shutdown');
    await ready();
    view.when = 'now';
    await view.confirm('reboot');
    dismiss({ role: 'confirm' });
    await confirmed;
    const request = http.expectOne(`${base}/shutdown`);
    expect(request.request.body).toEqual({ when: '+1' });
    await view.confirm('shutdown');
    http.expectNone(`${base}/shutdown`);
    request.flush({ scheduled: true, when: '+1' });
    expect(view.busy()).toBe(false);
    expect(TestBed.inject(AlertController).create).toHaveBeenCalledTimes(2);
  });
  it('invalidates confirmation on leave and session transitions, including async creation', async () => {
    const view = enter().componentInstance.state;
    const leaving = view.confirm('shutdown');
    await ready();
    view.ionViewWillLeave();
    dismiss({ role: 'confirm' });
    await leaving;
    http.expectNone(`${base}/shutdown`);
    expect(dialog.dismiss).toHaveBeenCalled();
    view.ionViewWillEnter();
    view.enterEnergy();
    http.expectNone(`${base}/info`);
    http.expectOne(`${base}/health`).flush(health);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    const session = view.confirm('reboot');
    TestBed.inject(ThemeIdentity).clear();
    await session;
    expect(dialog.remove).toHaveBeenCalled();
    http.expectNone(`${base}/reboot`);
    expect(view.health.data()).toBeNull();
  });
  it('invalidates pending confirmation on tab leave, even after returning to Energy', async () => {
    const view = enter().componentInstance.state;
    const pending = view.confirm('shutdown');
    await ready();
    view.leaveEnergy();
    view.enterEnergy();
    dismiss({ role: 'confirm' });
    await pending;
    http.expectNone(`${base}/shutdown`);
    expect(view.busy()).toBe(false);
    expect(view.health.data()).toEqual(health);
    expect(dialog.dismiss).toHaveBeenCalled();
  });
  it('invalidates asynchronous dialog creation on tab leave and keeps a sent request blocked across tabs', async () => {
    const view = enter().componentInstance.state;
    const pending = view.confirm('reboot');
    view.leaveEnergy();
    view.enterEnergy();
    await pending;
    expect(dialog.remove).toHaveBeenCalled();
    http.expectNone(`${base}/reboot`);
    const sent = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await sent;
    const action = http.expectOne(`${base}/reboot`);
    view.leaveEnergy();
    expect(view.busy()).toBe(true);
    view.enterEnergy();
    await view.confirm('shutdown');
    http.expectNone(`${base}/shutdown`);
    action.error(new ProgressEvent('error'));
    expect(view.busy()).toBe(false);
    expect(view.health.data()).toEqual(health);
  });
  it('discards late responses on leave, reloads on entry and unlocks after a failed execution', async () => {
    const view = enter().componentInstance.state;
    const operation = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await operation;
    const action = http.expectOne(`${base}/reboot`);
    view.ionViewWillLeave();
    action.flush({ scheduled: true, when: '+1' });
    expect(view.busy()).toBe(false);
    expect(view.health.data()).toBeNull();
    view.ionViewWillEnter();
    view.enterEnergy();
    http.expectNone(`${base}/info`);
    http.expectOne(`${base}/health`).flush(health);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    const uncertain = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await uncertain;
    http.expectOne(`${base}/reboot`).error(new ProgressEvent('error'));
    expect(view.busy()).toBe(false);
    http.expectNone(`${base}/reboot`);
  });
});

describe('System shared tab state', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());

  it.each(['health', 'wake'] as const)(
    'guards inactive and duplicate %s loads and preserves its snapshot on failure',
    (key) => {
      const state = TestBed.inject(SystemFacade);
      const section = state[key];
      const path = key === 'health' ? 'health' : 'wake-capabilities';
      const refresh = () => (key === 'health' ? state.refreshHealth() : state.refreshWake());
      const snapshot = key === 'health' ? health : wake;

      refresh();
      http.expectNone(`${base}/${path}`);
      state.ionViewWillEnter();
      refresh();
      http.expectOne(`${base}/health`).flush(health);
      http.expectOne(`${base}/wake-capabilities`).flush(wake);
      const updated = section.updated();
      expect(updated).toBeInstanceOf(Date);

      refresh();
      expect(section.loading()).toBe(true);
      expect(section.data()).toEqual(snapshot);
      expect(section.error()).toBe('');
      refresh();
      http.expectOne(`${base}/${path}`).error(new ProgressEvent('error'));
      expect(section.loading()).toBe(false);
      expect(section.error()).not.toBe('');
      expect(section.data()).toEqual(snapshot);
      expect(section.updated()).toBe(updated);
      http.expectNone(`${base}/${path}`);

      refresh();
      expect(section.error()).toBe('');
      http.expectOne(`${base}/${path}`).flush(null);
      expect(section.data()).toBeNull();
      expect(section.loading()).toBe(false);
      expect(section.updated()).not.toBe(updated);
    },
  );

  it.each(['leave', 'session', 'destroy'] as const)(
    'clears pending section loads on %s and discards both late responses',
    (transition) => {
      const state = TestBed.inject(SystemFacade);
      state.ionViewWillEnter();
      const pendingHealth = http.expectOne(`${base}/health`);
      const pendingWake = http.expectOne(`${base}/wake-capabilities`);
      if (transition === 'leave') state.ionViewWillLeave();
      else if (transition === 'session') TestBed.inject(ThemeIdentity).clear();
      else state.ngOnDestroy();

      pendingHealth.flush(health);
      pendingWake.flush(wake);
      for (const section of state.sections) {
        expect(section.data()).toBeNull();
        expect(section.loading()).toBe(false);
        expect(section.error()).toBe('');
        expect(section.updated()).toBeNull();
      }
      state.refreshHealth();
      state.refreshWake();
      http.expectNone(`${base}/health`);
      http.expectNone(`${base}/wake-capabilities`);
    },
  );

  it('shares the same snapshots across tabs, loads once and refreshes only the requested section', () => {
    const overview = TestBed.createComponent(SystemOverview).componentInstance;
    const energy = TestBed.createComponent(SystemEnergy).componentInstance;
    expect(overview.state).toBe(energy.state);
    const state = overview.state;
    state.ionViewWillEnter();
    const firstHealth = http.expectOne(`${base}/health`);
    const firstWake = http.expectOne(`${base}/wake-capabilities`);
    expect(state.health.loading()).toBe(true);
    firstHealth.flush(health);
    expect(state.wake.loading()).toBe(true);
    firstWake.flush(wake);
    energy.ionViewWillEnter();
    energy.ionViewWillLeave();
    state.ionViewWillEnter();
    expect(state.health.data()).toEqual(health);
    expect(state.wake.data()).toEqual(wake);
    http.expectNone(`${base}/health`);
    http.expectNone(`${base}/wake-capabilities`);
    state.refreshWake();
    http.expectNone(`${base}/health`);
    http.expectOne(`${base}/wake-capabilities`).flush(null);
    expect(state.wake.data()).toBeNull();
    expect(state.health.data()).toEqual(health);
  });

  it('reactivates the shared facade when Ionic reuses a cached child after leaving System', () => {
    const overview = TestBed.createComponent(SystemOverview).componentInstance;
    const energy = TestBed.createComponent(SystemEnergy).componentInstance;
    const inspector = TestBed.createComponent(SystemInspector).componentInstance;
    for (const page of [overview, energy, inspector]) {
      page.ionViewWillEnter();
      http.expectOne(`${base}/health`).flush(health);
      http.expectOne(`${base}/wake-capabilities`).flush(wake);
      expect(page.state.health.data()).toEqual(health);
      expect(page.state.wake.data()).toEqual(wake);
      page.state.ionViewWillLeave();
      expect(page.state.health.data()).toBeNull();
    }
  });

  it('clears session data and drains a late Health response without repopulating the facade', () => {
    const state = TestBed.inject(SystemFacade);
    state.ionViewWillEnter();
    const old = http.expectOne(`${base}/health`);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    TestBed.inject(ThemeIdentity).clear();
    old.flush(health);
    expect(state.health.data()).toBeNull();
    expect(state.wake.data()).toBeNull();
    expect(state.sensors()).toEqual([]);
    expect(state.health.updated()).toBeNull();
  });
});
