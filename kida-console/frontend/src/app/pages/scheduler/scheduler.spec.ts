import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { SchedulerService } from './scheduler.service';
import { Scheduler } from './scheduler';
import { ListedSchedule } from './scheduler.models';
import { createBody, emptyForm, freezeSnapshot, localToUtc } from './scheduler-form';
import { localDate, schedulerFailure, ruleSummary } from './scheduler-presentation';
import { schedulerActions } from './scheduler.actions';

const base = `${environment.apiBaseUrl}/scheduler`;
const entry: ListedSchedule = {
  id: 'c6482104-f062-44d2-9fbe-53942c708567',
  origin: 'USER',
  command: 'system.info',
  params: null,
  schedule: { type: 'interval', seconds: 60, futureRule: 'visible' },
  next_enqueue_at: '2030-01-01T12:00:00Z',
  future: { extra: 'visible' },
};
function setup() {
  TestBed.configureTestingModule({
    imports: [Scheduler],
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

describe('Scheduler API through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());
  it('registers three independent channels without a global loader', () => {
    expect(schedulerActions.map((a) => a.actionName)).toEqual([
      'SCHEDULER_LIST_REQUEST',
      'SCHEDULER_ADD_REQUEST',
      'SCHEDULER_DELETE_REQUEST',
    ]);
    for (const action of schedulerActions) expect(action.urlRequest?.useLoader).toBe(false);
  });
  it('substitutes the exact query for every allowed filter and preserves response fields', () => {
    for (const origin of ['USER', 'INTERNAL', 'ALL'] as const) {
      const next = vi.fn();
      TestBed.inject(SchedulerService).list(origin).subscribe(next);
      const r = http.expectOne(`${base}?origin=${origin}`);
      expect(r.request.method).toBe('GET');
      expect(r.request.withCredentials).toBe(true);
      const data = origin === 'ALL' ? [{ ...entry, origin: 'FUTURE' }] : [];
      r.flush(data);
      expect(next).toHaveBeenCalledWith(data);
    }
  });
});

describe('Scheduler validation', () => {
  const form = {
    ...emptyForm(),
    command: ' system.info ',
    mode: 'interval' as const,
    seconds: '60',
  };
  it.each([
    '{}',
    'null',
    '[]',
    '[1,true,null]',
    '"<img src=x>"',
    '42',
    '1.25',
    'true',
    '9007199254740991',
    '-9007199254740991',
  ])('accepts JSON %s without command transformation', (params) => {
    expect(createBody({ ...form, params })).toEqual({
      command: form.command,
      params: JSON.parse(params),
      schedule: { type: 'interval', seconds: 60 },
    });
  });
  it.each([
    '',
    '{',
    'NaN',
    'Infinity',
    '1e400',
    '9007199254740992',
    '-9007199254740992',
    '{"nested":[1e400]}',
    '{"n":9007199254740993}',
  ])('rejects malformed or unsafe JSON %s', (params) =>
    expect(() => createBody({ ...form, params })).toThrow('JSON'),
  );
  it.each(['', '0', '-1', '1.5', '1e3', ' 60', '60\n', '9007199254740992'])(
    'rejects interval %s',
    (seconds) => expect(() => createBody({ ...form, seconds })).toThrow('intervalo'),
  );
  it('accepts safe interval limits and sends only the selected modality', () => {
    for (const seconds of ['1', '9007199254740991'])
      expect(createBody({ ...form, seconds }).schedule).toEqual({
        type: 'interval',
        seconds: Number(seconds),
      });
    expect(
      createBody({ ...form, mode: 'cron', expression: ' 0 2 * * * ', timezone: ' Europe/Madrid ' })
        .schedule,
    ).toEqual({ type: 'cron', expression: ' 0 2 * * * ', timezone: ' Europe/Madrid ' });
    expect(createBody({ ...form, mode: 'once', local: '2030-01-01T12:00:37' }).schedule).toEqual({
      type: 'once',
      at: localToUtc('2030-01-01T12:00:37'),
    });
    for (const patch of [
      { command: ' ' },
      { mode: 'cron' as const, expression: '' },
      { mode: 'cron' as const, expression: '* * * * *', timezone: '' },
    ])
      expect(() => createBody({ ...form, ...patch })).toThrow();
  });
  it.each([
    '2030-02-30T12:00:00',
    '2030-13-01T12:00:00',
    '2030-01-01T24:00:00',
    '2030-01-01T12:60:00',
    '2030-01-01T12:00:60',
    '',
    '2030-01-01',
  ])('rejects invalid local date %s', (value) => expect(() => localToUtc(value)).toThrow());
  it('converts local components and seconds to RFC3339 UTC', () => {
    const expected = new Date(2030, 0, 1, 12, 0, 37).toISOString();
    expect(localToUtc('2030-01-01T12:00:37')).toBe(expected);
    expect(localDate(expected)).toContain('UTC');
  });
  it('rejects the DST gap and selects the first overlap occurrence in Europe/Madrid', () => {
    vi.stubEnv('TZ', 'Europe/Madrid');
    try {
      expect(() => localToUtc('2030-03-31T02:30:15')).toThrow('no existe');
      expect(localToUtc('2030-10-27T02:30:15')).toBe('2030-10-27T00:30:15.000Z');
      expect(localDate(localToUtc('2030-10-27T02:30:15'))).toContain('UTC+02:00');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('shows a true UTC equivalent for existing once schedules with an offset', () => {
    expect(ruleSummary({ type: 'once', at: '2030-01-01T12:00:00+02:00' })).toContain(
      'UTC: 2030-01-01T10:00:00.000Z',
    );
  });
  it('deep freezes independent snapshots including nested parameters', () => {
    const value = { params: { nested: [1] } };
    const copy = freezeSnapshot(value);
    value.params.nested[0] = 2;
    expect(copy.params.nested).toEqual([1]);
    expect(Object.isFrozen(copy.params.nested)).toBe(true);
  });
  it('distinguishes confirmed rejection, validation, unavailability, session and uncertainty', () => {
    const fail = (status: number, code = '') =>
      new HttpErrorResponse({ status, error: { detail: { code, message: 'reason' } } });
    for (const code of [
      'core_timeout',
      'core_transport_error',
      'core_http_error',
      'core_invalid_response',
    ])
      expect(schedulerFailure(fail(502, code), true)).toContain(
        'Actualiza el listado antes de repetir',
      );
    for (const status of [0, 500, 504])
      expect(schedulerFailure(fail(status), true)).toContain('No se pudo confirmar');
    expect(schedulerFailure(fail(503, 'core_unavailable'), true)).toContain('Sin conexión');
    expect(schedulerFailure(fail(502, 'core_error'), true)).toContain('CORE rechazó');
    expect(schedulerFailure(fail(422), true)).toContain('Validación HTTP');
    expect(schedulerFailure(fail(401), true)).toContain('sesión');
  });
});

describe('Scheduler page', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
    // jsdom has no modal top layer. Real focus/keyboard behavior is checked with Playwright.
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
    http.verify();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  function enter(data = [entry]) {
    const fixture = TestBed.createComponent(Scheduler);
    fixture.detectChanges();
    const view = fixture.componentInstance;
    view.ionViewWillEnter();
    expect(view.loading()).toBe(true);
    http.expectOne(`${base}?origin=USER`).flush(data);
    fixture.detectChanges();
    view.form = {
      ...emptyForm(),
      command: 'system.info',
      mode: 'interval',
      seconds: '60',
      params: '{"nested":[1]}',
    };
    return fixture;
  }
  it('renders empty states, safe HTML text, future fields and unknown origins without delete', () => {
    const fixture = enter([]);
    expect(fixture.nativeElement.textContent).toContain('No hay programaciones');
    const view = fixture.componentInstance;
    view.refresh();
    const unsafe = '<img src=x onerror="alert(1)">';
    http
      .expectOne(`${base}?origin=USER`)
      .flush([{ ...entry, origin: 'FUTURE', command: unsafe, params: { html: unsafe } }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(unsafe);
    expect(fixture.nativeElement.textContent).toContain('futureRule');
    expect(fixture.nativeElement.textContent).toContain('next_enqueue_at');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.schedule-list button')).toBeNull();
    for (const origin of ['INTERNAL', 'FUTURE']) view.prepareDelete({ ...entry, origin });
    view.confirm();
    http.expectNone(`${base}/delete`);
  });
  it('retains stale data with the original filter and timestamp when a different filter fails', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    const updated = view.updated();
    view.selectOrigin('ALL');
    view.selectOrigin('INTERNAL');
    expect(view.origin).toBe('ALL');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#scheduler-origin').disabled).toBe(true);
    http.expectOne(`${base}?origin=ALL`).error(new ProgressEvent('error'));
    expect(view.entries()).toEqual([entry]);
    expect(view.visibleOrigin()).toBe('USER');
    expect(view.updated()).toBe(updated);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('desactualizados');
    expect(fixture.nativeElement.textContent).toContain('Origen de los datos visibles: Usuario');
    http.expectNone(`${base}?origin=ALL`);
  });
  it('cancels without a request and freezes the exact summary/body, blocking double clicks', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.prepareAdd();
    view.cancel();
    expect(view.form.params).toBe('{"nested":[1]}');
    http.expectNone(`${base}/add`);
    view.form.command = '<b>command</b>';
    view.prepareAdd();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog');
    expect(dialog.textContent).toContain('<b>command</b>');
    expect(dialog.querySelector('b')).toBeNull();
    view.form.command = 'changed';
    view.form.params = 'null';
    view.prepareDelete(entry);
    view.prepareAdd();
    view.confirm();
    view.confirm();
    const request = http.expectOne(`${base}/add`);
    expect(request.request.body).toEqual({
      command: '<b>command</b>',
      params: { nested: [1] },
      schedule: { type: 'interval', seconds: 60 },
    });
    request.flush(entry);
    http.expectOne(`${base}?origin=USER`).flush([entry]);
    expect(view.form).toEqual(emptyForm());
    expect(view.busy()).toBe(false);
  });
  it('deletes only USER entries with an independent id and refreshes the current filter', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.selectOrigin('ALL');
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
    const selected = structuredClone(entry);
    view.prepareDelete(selected);
    selected.id = 'changed';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog').textContent).toContain(
      'no cancela comandos ya encolados',
    );
    view.confirm();
    const request = http.expectOne(`${base}/delete`);
    expect(request.request.body).toEqual({ id: entry.id });
    request.flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([]);
    expect(view.resultLabel()).toBe('Programación eliminada');
  });
  it('keeps action success separate from refresh failure', () => {
    const view = enter().componentInstance;
    view.prepareAdd();
    view.confirm();
    http.expectOne(`${base}/add`).flush(entry);
    http.expectOne(`${base}?origin=USER`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.result()).toEqual(entry);
    expect(view.resultLabel()).toBe('Programación creada');
    expect(view.error()).toBe('');
    expect(view.listError()).not.toBe('');
    expect(view.entries()).toEqual([entry]);
  });
  it('preserves form on rejection/uncertainty and never retries writes', () => {
    const view = enter().componentInstance;
    const form = structuredClone(view.form);
    for (const status of [422, 504, 0]) {
      view.prepareAdd();
      view.confirm();
      const request = http.expectOne(`${base}/add`);
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush({}, { status, statusText: 'Failed' });
      expect(view.error()).toContain(
        status === 422 ? 'Validación HTTP' : 'Actualiza el listado antes de repetir',
      );
      expect(view.form).toEqual(form);
      expect(view.busy()).toBe(false);
      http.expectNone(`${base}/add`);
      http.expectNone(`${base}?origin=USER`);
    }
  });
  it('blocks invalid forms and invalidates confirmations on leave or session change', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.form.params = '{';
    view.prepareAdd();
    expect(view.pending()).toBeNull();
    expect(view.error()).toContain('JSON');
    view.form.params = '{}';
    view.prepareAdd();
    view.ionViewWillLeave();
    view.confirm();
    http.expectNone(`${base}/add`);
    expect(view.form).toEqual(emptyForm());
    view.ionViewWillEnter();
    http.expectOne(`${base}?origin=USER`).flush([entry]);
    view.prepareDelete(entry);
    TestBed.inject(ThemeIdentity).clear();
    view.confirm();
    view.prepareDelete(entry);
    view.refresh();
    http.expectNone(`${base}/delete`);
    http.expectNone(`${base}?origin=USER`);
    expect(view.entries()).toBeNull();
    expect(view.pending()).toBeNull();
  });
  it.each(['add', 'delete'] as const)(
    'recovers if the %s confirmation cannot open, without sending',
    (action) => {
      const fixture = enter(),
        view = fixture.componentInstance;
      const form = structuredClone(view.form);
      vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementationOnce(() => {
        throw new DOMException('Disconnected dialog', 'InvalidStateError');
      });
      if (action === 'add') view.prepareAdd();
      else view.prepareDelete(entry);
      expect(view.pending()).toBeNull();
      expect(view.busy()).toBe(false);
      expect(view.error()).toBe('No se pudo abrir la confirmación.');
      expect(view.form).toEqual(form);
      view.confirm();
      http.expectNone(`${base}/${action}`);
      // A subsequent attempt is available after the presentation failure.
      if (action === 'add') view.prepareAdd();
      else view.prepareDelete(entry);
      expect(view.pending()?.action).toBe(action);
      view.cancel();
      http.expectNone(`${base}/${action}`);
    },
  );
  it('restores creation focus after the refresh has enabled the trigger again', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    view.prepareAdd();
    view.confirm();
    http.expectOne(`${base}/add`).flush(entry);
    const refresh = http.expectOne(`${base}?origin=USER`);
    fixture.detectChanges();
    expect(trigger.disabled).toBe(true);
    refresh.flush([entry]);
    TestBed.tick();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(trigger.disabled).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
  it('focuses the list heading if deleting removed the original trigger', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector(
      '.schedule-list button',
    ) as HTMLButtonElement;
    trigger.focus();
    view.prepareDelete(entry);
    view.confirm();
    http.expectOne(`${base}/delete`).flush(entry);
    http.expectOne(`${base}?origin=USER`).flush([]);
    TestBed.tick();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h2[tabindex="-1"]'));
  });
  it('blocks a manual refresh while confirming or sending a write', () => {
    const view = enter().componentInstance;
    view.prepareAdd();
    view.refresh();
    http.expectNone(`${base}?origin=USER`);
    view.confirm();
    view.refresh();
    http.expectNone(`${base}?origin=USER`);
    http.expectOne(`${base}/add`).flush(entry);
    http.expectOne(`${base}?origin=USER`).flush([entry]);
  });
});
