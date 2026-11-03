import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { ArcaRequestService } from '../../../services/arca-request.service';
import { SystemService } from '../services/system.service';
import { SystemFacade } from '../services/system.facade';
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
      provideHttpClientTesting(),
      {
        provide: ArcaService,
        useFactory: () => ({
          actions: inject(ArcaActionsService),
          panels: inject(ArcaPanelsService),
          modals: inject(ArcaModalService),
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

describe('System page through ARCA dialogs', () => {
  let http: HttpTestingController;
  let open: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    http = setup();
    open = vi.spyOn(TestBed.inject(ArcaModalService), 'openModal').mockResolvedValue();
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
  function respond(option = 'confirm', context = open.mock.calls.at(-1)![1].context) {
    TestBed.inject(ArcaActionsService).dispatchAction('SYSTEM_DIALOG_CLOSE', {
      option,
      data: { context },
    });
  }
  function returnToEnergy(view: SystemFacade) {
    view.ionViewWillEnter();
    http
      .match((request) => request.method === 'GET')
      .forEach((request) => request.flush(request.request.url.endsWith('/health') ? health : wake));
    view.enterEnergy();
  }
  it('places the three energy panels in masonry', () => {
    const fixture = enter();
    const masonry = fixture.nativeElement.querySelector('app-system-energy app-masonry');
    expect(
      [...masonry.querySelectorAll(':scope > [appMasonryItem]')].map((item: any) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual(['Capacidades RTC', 'Apagado y reinicio', 'Ciclo de energía']);
  });
  it('updates quick choices and manual input without sending an operation', async () => {
    const fixture = enter();
    const card: HTMLElement = fixture.nativeElement.querySelector('app-system-power-card');
    const input = card.querySelector<HTMLInputElement>('#power-when')!;
    const choices = [...card.querySelectorAll<HTMLButtonElement>('.quick-action')];
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
      expect(choices[index].getAttribute('aria-pressed')).toBe('true');
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
    expect(
      [...card.querySelectorAll<HTMLButtonElement>('.power-buttons button')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
    http.expectNone((request) => request.method === 'POST');
  });
  it.each(['shutdown', 'reboot'] as const)(
    'confirms %s from the card with frozen parameters',
    (action) => {
      const fixture = enter();
      const view = fixture.componentInstance.state;
      const card: HTMLElement = fixture.nativeElement.querySelector('app-system-power-card');
      if (action === 'shutdown')
        card
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      else card.querySelectorAll<HTMLButtonElement>('.power-buttons button')[1].click();
      fixture.detectChanges();
      expect(
        [...card.querySelectorAll<HTMLButtonElement>('.power-buttons button')].every(
          (button) => button.disabled,
        ),
      ).toBe(true);
      view.when = 'now';
      respond('confirm', 'unrelated');
      http.expectNone(`${base}/${action}`);
      respond();
      const request = http.expectOne(`${base}/${action}`);
      expect(request.request.body).toEqual({ when: '+1' });
      request.flush({ scheduled: true, when: '+1' });
      expect(view.busy()).toBe(false);
    },
  );
  it('rejects invalid parameters, inactive views, other tabs and a globally occupied modal', () => {
    const view = enter().componentInstance.state;
    view.when = 'invalid';
    view.confirm('shutdown');
    view.wakeTime = 'invalid';
    view.confirm('powerCycle');
    view.when = '+1';
    view.leaveEnergy();
    view.confirm('shutdown');
    returnToEnergy(view);
    TestBed.inject(ArcaModalService).modalOpen = true;
    view.confirm('shutdown');
    TestBed.inject(ArcaModalService).modalOpen = false;
    view.ionViewWillLeave();
    view.confirm('shutdown');
    expect(open).not.toHaveBeenCalled();
    http.expectNone((request) => request.method === 'POST');
  });
  it.each(['time', 'seconds'])('freezes the %s cycle body and shared dialog summary', (mode) => {
    const view = enter().componentInstance.state;
    const execute = vi.spyOn(TestBed.inject(SystemService), 'execute');
    view.wakeMode = mode;
    view.wakeTime = '08:30';
    view.wakeSeconds = '240';
    view.shutdownTime = '23:00';
    view.confirm('powerCycle');
    const config = open.mock.calls[0][1];
    expect(config.text.join(' ')).toContain(mode === 'time' ? '08:30' : '240 segundos');
    expect(config.text.join(' ')).toContain('23:00');
    expect(config.text.join(' ')).toContain('Horas locales del servidor');
    view.wakeTime = '09:00';
    view.wakeSeconds = '360';
    view.shutdownTime = '';
    respond();
    const pending = execute.mock.calls[0][0];
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(pending.body)).toBe(true);
    const request = http.expectOne(`${base}/power-cycle`);
    expect(request.request.body).toEqual({
      ...(mode === 'time' ? { wake_time: '08:30' } : { wake_after_seconds: 240 }),
      shutdown_time: '23:00',
    });
    request.flush({ shutdown_scheduled: true });
  });
  it.each(['cancel', 'backdrop'])('does not execute a %s choice', (option) => {
    const view = enter().componentInstance.state;
    view.confirm('shutdown');
    respond(option);
    expect(view.busy()).toBe(false);
    http.expectNone((request) => request.method === 'POST');
  });
  it.each(['sync', 'async'])(
    'releases the local lock after a %s ARCA opening failure',
    async (kind) => {
      const view = enter().componentInstance.state;
      if (kind === 'sync')
        open.mockImplementationOnce(() => {
          throw new Error('opening');
        });
      else open.mockRejectedValueOnce(new Error('opening'));
      view.confirm('shutdown');
      await Promise.resolve();
      expect(view.busy()).toBe(false);
      http.expectNone(`${base}/shutdown`);
      view.confirm('reboot');
      respond();
      http.expectOne(`${base}/reboot`).flush({ scheduled: true });
    },
  );
  it('recovers from synchronous execution failure without retrying', () => {
    const view = enter().componentInstance.state;
    vi.spyOn(TestBed.inject(SystemService), 'execute').mockImplementationOnce(() => {
      throw new Error('execute');
    });
    view.confirm('shutdown');
    respond();
    expect(view.busy()).toBe(false);
    http.expectNone(`${base}/shutdown`);
    view.confirm('reboot');
    respond();
    http.expectOne(`${base}/reboot`).flush({ scheduled: true });
  });
  it.each(['tab', 'view', 'session', 'destroy'] as const)(
    'invalidates before cancellation on %s and ignores an old acceptance',
    (leaving) => {
      const view = enter().componentInstance.state;
      view.confirm('shutdown');
      const old = open.mock.calls[0][1].context;
      const actions = TestBed.inject(ArcaActionsService);
      const dispatch = vi.spyOn(actions, 'dispatchAction');
      if (leaving === 'tab') view.leaveEnergy();
      else if (leaving === 'view') view.ionViewWillLeave();
      else if (leaving === 'session') TestBed.inject(ThemeIdentity).clear();
      else view.ngOnDestroy();
      expect(dispatch).toHaveBeenCalledWith('APP_DIALOG_CANCEL', old);
      expect(view.busy()).toBe(false);
      respond('confirm', old);
      http.expectNone(`${base}/shutdown`);
      if (leaving === 'destroy') return;
      returnToEnergy(view);
      view.confirm('reboot');
      respond('confirm', old);
      expect(view.busy()).toBe(true);
      http.expectNone(`${base}/shutdown`);
      respond();
      http.expectOne(`${base}/reboot`).flush({ scheduled: true });
    },
  );
  it('ignores a late opening failure without unlocking a newer confirmation', async () => {
    const view = enter().componentInstance.state;
    let reject!: (reason: Error) => void;
    open.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    view.confirm('shutdown');
    view.leaveEnergy();
    view.enterEnergy();
    view.confirm('reboot');
    reject(new Error('late'));
    await Promise.resolve();
    expect(view.busy()).toBe(true);
    respond('cancel');
    expect(view.busy()).toBe(false);
    http.expectNone((request) => request.method === 'POST');
  });
  it('consumes a confirmation once and keeps an in-flight write locked across tabs', () => {
    const view = enter().componentInstance.state;
    view.confirm('shutdown');
    view.confirm('reboot');
    expect(open).toHaveBeenCalledTimes(1);
    const context = open.mock.calls[0][1].context;
    respond();
    respond('confirm', context);
    const request = http.expectOne(`${base}/shutdown`);
    view.leaveEnergy();
    view.enterEnergy();
    view.confirm('reboot');
    expect(view.busy()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    request.error(new ProgressEvent('error'));
    expect(view.busy()).toBe(false);
    http.expectNone(`${base}/shutdown`);
  });
  it.each(['cancel', 'success', 'failure', 'start-failure'])(
    'restores workflow focus after %s',
    (outcome) => {
      const view = enter().componentInstance.state;
      const trigger = document.createElement('button');
      document.body.append(trigger);
      trigger.focus();
      const focus = vi.spyOn(trigger, 'focus');
      if (outcome === 'start-failure')
        vi.spyOn(TestBed.inject(SystemService), 'execute').mockImplementationOnce(() => {
          throw new Error();
        });
      view.confirm('shutdown');
      respond(outcome === 'cancel' ? 'cancel' : 'confirm');
      if (outcome !== 'cancel' && outcome !== 'start-failure') {
        const request = http.expectOne(`${base}/shutdown`);
        if (outcome === 'success') request.flush({ scheduled: true });
        else request.error(new ProgressEvent('error'));
      }
      TestBed.tick();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      trigger.remove();
    },
  );
  it('invalidates queued focus after leaving and returning to Energy', () => {
    const view = enter().componentInstance.state;
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const focus = vi.spyOn(trigger, 'focus');
    view.confirm('shutdown');
    respond('cancel');
    view.leaveEnergy();
    view.enterEnergy();
    TestBed.tick();
    expect(focus).not.toHaveBeenCalled();
    trigger.remove();
  });
  it('discards late HTTP responses on leave and reloads on reentry', () => {
    const view = enter().componentInstance.state;
    view.confirm('reboot');
    respond();
    const request = http.expectOne(`${base}/reboot`);
    view.ionViewWillLeave();
    request.flush({ scheduled: true });
    expect(view.health.data()).toBeNull();
    expect(view.busy()).toBe(false);
    returnToEnergy(view);
    view.confirm('reboot');
    respond();
    http.expectOne(`${base}/reboot`).error(new ProgressEvent('error'));
    expect(view.health.data()).toEqual(health);
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
