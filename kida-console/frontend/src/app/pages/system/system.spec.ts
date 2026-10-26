import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { ArcaRequestService, ChannelBusyError } from '../../services/arca-request.service';
import { SystemService } from './system.service';
import { System } from './system';
import { cycleRequest, systemFailure, validWhen } from './system.models';
import { systemActions } from './system.actions';

const base = `${environment.apiBaseUrl}/system`;
const info = {
  hostname: null,
  os: { name: 'Linux', version: null },
  memory: { total_bytes: 1024 ** 3 },
  graphics: [],
  disks: [],
  future: { extra: 'visible' },
};
const health = { overall: 'unknown', sensors: [] };
const wake = {
  rtc_device: null,
  rtcwake_available: true,
  rtc_alarm_available: null,
  s5_wake_status: 'unverified',
  warnings: [],
};

function setup() {
  TestBed.configureTestingModule({
    imports: [System],
    providers: [
      ...appConfig.providers,
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

  it('registers six distinct channels without the global loader', () => {
    expect(systemActions).toHaveLength(6);
    expect(new Set(systemActions.map((a) => a.actionName)).size).toBe(6);
    for (const action of systemActions) expect(action.urlRequest?.useLoader).toBe(false);
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
  it('rejects same-channel duplicates and drains late results after consumer teardown', () => {
    const service = TestBed.inject(SystemService);
    const first = vi.fn();
    const sub = service.info().subscribe(first);
    const pending = http.expectOne(`${base}/info`);
    sub.unsubscribe();
    const failure = vi.fn();
    service.info().subscribe({ error: failure });
    expect(failure.mock.calls[0][0]).toBeInstanceOf(ChannelBusyError);
    http.expectNone(`${base}/info`);
    pending.flush(info);
    expect(first).not.toHaveBeenCalled();
    const next = vi.fn();
    service.info().subscribe(next);
    expect(next).not.toHaveBeenCalled();
    http.expectOne(`${base}/info`).flush({ ...info, hostname: 'fresh' });
    expect(next).toHaveBeenCalledWith({ ...info, hostname: 'fresh' });
    const actions = TestBed.inject(ArcaActionsService);
    for (const suffix of ['REQUEST', 'RESPONSE', 'ERROR'])
      expect(actions.getDataSnapshot(`SYSTEM_INFO_${suffix}`)).toBe('undefined');
  });
  it('ignores old-session results while a new request uses the same channel', () => {
    const service = TestBed.inject(SystemService);
    const old = vi.fn(),
      complete = vi.fn(),
      fresh = vi.fn();
    service.info().subscribe({ next: old, complete });
    const first = http.expectOne(`${base}/info`);
    TestBed.inject(ThemeIdentity).begin();
    expect(complete).toHaveBeenCalledOnce();
    service.info().subscribe(fresh);
    const second = http.expectOne(`${base}/info`);
    first.flush(info);
    expect(fresh).not.toHaveBeenCalled();
    expect(old).not.toHaveBeenCalled();
    second.flush({ hostname: 'second' });
    expect(fresh).toHaveBeenCalledWith({ hostname: 'second' });
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
    const fixture = TestBed.createComponent(System);
    fixture.componentInstance.ionViewWillEnter();
    http.expectOne(`${base}/info`).flush(info);
    http.expectOne(`${base}/health`).flush(health);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    fixture.detectChanges();
    return fixture;
  }
  async function ready() {
    await Promise.resolve();
    await Promise.resolve();
  }
  it('renders unknown values, empty lists, extended fields and the S5 limitation', () => {
    const fixture = enter();
    const text = fixture.nativeElement.textContent;
    for (const expected of [
      'Desconocido',
      'Sin elementos',
      'future',
      'visible',
      'Sin verificar',
      'no demuestra',
      'Instantánea',
    ])
      expect(text).toContain(expected);
  });
  it('retains partial/stale data with independent errors and update timestamps', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    const timestamp = view.info.updated();
    view.refresh(view.info);
    http.expectOne(`${base}/info`).error(new ProgressEvent('error'));
    expect(view.info.data()).toEqual(info);
    expect(view.info.updated()).toBe(timestamp);
    expect(view.info.error()).toContain('Sin conexión');
    expect(view.health.error()).toBe('');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Datos anteriores');
  });
  it('cancels without sending an action and freezes confirmed parameters, blocking duplicates', async () => {
    const view = enter().componentInstance;
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
    expect(view.result()).toEqual({ scheduled: true, when: '+1' });
    expect(TestBed.inject(AlertController).create).toHaveBeenCalledTimes(2);
  });
  it('invalidates confirmation on leave and session transitions, including async creation', async () => {
    const view = enter().componentInstance;
    const leaving = view.confirm('shutdown');
    await ready();
    view.ionViewWillLeave();
    dismiss({ role: 'confirm' });
    await leaving;
    http.expectNone(`${base}/shutdown`);
    expect(dialog.dismiss).toHaveBeenCalled();
    view.ionViewWillEnter();
    http.expectOne(`${base}/info`).flush(info);
    http.expectOne(`${base}/health`).flush(health);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    const session = view.confirm('reboot');
    TestBed.inject(ThemeIdentity).clear();
    await session;
    expect(dialog.remove).toHaveBeenCalled();
    http.expectNone(`${base}/reboot`);
    expect(view.info.data()).toBeNull();
    expect(view.result()).toBeNull();
  });
  it('discards late results on leave, reloads on entry and shows uncertain execution', async () => {
    const view = enter().componentInstance;
    const operation = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await operation;
    const action = http.expectOne(`${base}/reboot`);
    view.ionViewWillLeave();
    action.flush({ scheduled: true, when: '+1' });
    expect(view.result()).toBeNull();
    view.ionViewWillEnter();
    http.expectOne(`${base}/info`).flush(info);
    http.expectOne(`${base}/health`).flush(health);
    http.expectOne(`${base}/wake-capabilities`).flush(wake);
    const uncertain = view.confirm('reboot');
    await ready();
    dismiss({ role: 'confirm' });
    await uncertain;
    http.expectOne(`${base}/reboot`).error(new ProgressEvent('error'));
    expect(view.error()).toContain('incierta');
    expect(view.busy()).toBe(false);
    http.expectNone(`${base}/reboot`);
  });
});
