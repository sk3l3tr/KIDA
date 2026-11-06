import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, TemplateRef, contentChild, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { By } from '@angular/platform-browser';
import { IonicModule } from '@ionic/angular';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonToolbar,
} from '@ionic/angular/standalone';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { SchedulerService } from '../services/scheduler.service';
import { Scheduler } from '../scheduler';
import { ListedSchedule } from '../utils/scheduler.models';
import { createBody, emptyForm, freezeSnapshot, localToUtc } from '../utils/scheduler-form';
import { localDate, schedulerFailure, ruleSummary } from '../utils/scheduler-presentation';
import { schedulerActions } from '../utils/scheduler.actions';

let dialogs: ReturnType<typeof mockArcaDialogs>;

// Simulate Ionic presentation; keep SidePanel, projected content and ARCA real.
@Component({
  selector: 'ion-modal',
  imports: [NgTemplateOutlet],
  template: '@if (isOpen()) { <ng-container [ngTemplateOutlet]="content() ?? null" /> }',
})
class TestSchedulerModal {
  readonly isOpen = input(false);
  readonly focusTrap = input(true);
  readonly enterAnimation = input<unknown>();
  readonly leaveAnimation = input<unknown>();
  readonly content = contentChild(TemplateRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  dismiss(): void {
    this.host.nativeElement.dispatchEvent(new CustomEvent('didDismiss'));
  }
}

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
          modals: inject(ArcaModalService),
        }),
      },
      { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(SidePanel, {
    remove: { imports: [IonicModule] },
    add: {
      imports: [TestSchedulerModal, IonButton, IonButtons, IonContent, IonHeader, IonToolbar],
    },
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  dialogs = mockArcaDialogs();
  return TestBed.inject(HttpTestingController);
}

describe('Scheduler API through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });
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
    // jsdom has no modal top layer; presentation is simulated above.
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });
  function enter(data = [entry]) {
    const fixture = TestBed.createComponent(Scheduler);
    fixture.detectChanges();
    const view = fixture.componentInstance.state;
    fixture.componentInstance.ionViewWillEnter();
    expect(view.loading()).toBe(true);
    http.expectOne(`${base}?origin=ALL`).flush(data);
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
  it('opens a common ARCA dialog with the frozen schedule summary', () => {
    const fixture = enter();
    fixture.componentInstance.state.prepareAdd();
    expect(dialogs.config?.title).toBe('Confirmar programación');
    expect(dialogs.config?.text).toEqual(
      expect.arrayContaining([expect.stringContaining('system.info')]),
    );
    dialogs.choose();
    http.expectOne(`${base}/add`).flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
  });
  it('shares page state with the extracted form and list through their DOM actions', async () => {
    const fixture = enter();
    fixture.nativeElement.querySelector('.scheduler-create').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const command = fixture.nativeElement.querySelector('#scheduler-command') as HTMLInputElement;
    command.value = 'system.health';
    command.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(dialogs.config?.text).toContain('Crear: system.health');
    dialogs.choose();
    const add = http.expectOne(`${base}/add`);
    expect(add.request.body.command).toBe('system.health');
    add.flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('tbody button.danger').click();
    expect(dialogs.config?.text).toContain(`Identificador: ${entry.id}`);
    dialogs.choose();
    const remove = http.expectOne(`${base}/delete`);
    expect(remove.request.body).toEqual({ id: entry.id });
    remove.flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([]);
  });
  it('opens the existing form only from the header CTA and preserves its draft on dismissal', async () => {
    const fixture = enter();
    const root = fixture.nativeElement as HTMLElement;
    const state = fixture.componentInstance.state;
    expect(root.querySelector('h1')?.textContent).toBe('Scheduler');
    expect(root.querySelector('.scheduler-heading')?.textContent).toContain('Nueva programación');
    expect(root.querySelector('.scheduler-layout form')).toBeNull();
    expect(root.querySelector('form')).toBeNull();
    root.querySelector<HTMLButtonElement>('.scheduler-create')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(state.createOpen()).toBe(true);
    expect(root.querySelector('app-side-panel form')).not.toBeNull();
    const command = root.querySelector<HTMLInputElement>('#scheduler-command')!;
    command.value = 'system.health';
    command.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('ion-modal')!.dispatchEvent(new CustomEvent('didDismiss'));
    fixture.detectChanges();
    expect(state.createOpen()).toBe(false);
    expect(root.querySelector('form')).toBeNull();
    root.querySelector<HTMLButtonElement>('.scheduler-create')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector<HTMLInputElement>('#scheduler-command')!.value).toBe('system.health');
    expect(state.form.command).toBe('system.health');
    http.expectNone(`${base}/add`);
    http.expectNone(`${base}?origin=ALL`);
  });
  it('releases the panel focus trap for confirmation and cancels it when the panel closes', () => {
    const fixture = enter();
    const state = fixture.componentInstance.state;
    state.openCreate();
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    expect(panel.focusTrap()).toBe(true);
    state.prepareAdd();
    fixture.detectChanges();
    expect(panel.focusTrap()).toBe(false);
    fixture.nativeElement.querySelector('ion-modal').dispatchEvent(new CustomEvent('didDismiss'));
    fixture.detectChanges();
    expect(state.createOpen()).toBe(false);
    expect(state.pending()).toBeNull();
    expect(state.busy()).toBe(false);
    state.confirm();
    http.expectNone(`${base}/add`);
  });
  it('closes creation and clears the draft on leave or identity change', () => {
    const fixture = enter();
    const state = fixture.componentInstance.state;
    state.openCreate();
    expect(state.createOpen()).toBe(true);
    fixture.componentInstance.ionViewWillLeave();
    expect(state.createOpen()).toBe(false);
    expect(state.form).toEqual(emptyForm());
    state.openCreate();
    expect(state.createOpen()).toBe(false);
    fixture.componentInstance.ionViewWillEnter();
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
    state.openCreate();
    expect(state.createOpen()).toBe(true);
    TestBed.inject(ThemeIdentity).clear();
    expect(state.createOpen()).toBe(false);
    expect(state.form).toEqual(emptyForm());
  });
  it('keeps deletion results visible without opening the creation panel', () => {
    const fixture = enter();
    const state = fixture.componentInstance.state;
    state.prepareDelete(entry);
    dialogs.choose();
    http.expectOne(`${base}/delete`).flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([]);
    fixture.detectChanges();
    expect(state.createOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('.scheduler-layout').textContent).toContain(
      'Programación eliminada',
    );
  });
  it('invalidates the local facade and its pending confirmation when the page is destroyed', () => {
    const fixture = enter();
    const state = fixture.componentInstance.state;
    state.prepareDelete(entry);
    fixture.destroy();
    expect(state.entries()).toBeNull();
    expect(state.pending()).toBeNull();
    state.confirm();
    TestBed.inject(ThemeIdentity).clear();
    http.expectNone(`${base}/delete`);
    http.expectNone(`${base}?origin=ALL`);
  });
  it('renders empty states, safe HTML text, future fields and unknown origins without delete', () => {
    const fixture = enter([]);
    expect(fixture.nativeElement.textContent).toContain('No hay programaciones');
    const view = fixture.componentInstance.state;
    view.selectOrigin('ALL');
    view.refresh();
    const unsafe = '<img src=x onerror="alert(1)">';
    http
      .expectOne(`${base}?origin=ALL`)
      .flush([{ ...entry, origin: 'FUTURE', command: unsafe, params: { html: unsafe } }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(unsafe);
    expect(fixture.nativeElement.textContent).toContain('futureRule');
    expect(fixture.nativeElement.textContent).toContain('next_enqueue_at');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('tbody button.danger')).toBeNull();
    for (const origin of ['INTERNAL', 'FUTURE']) view.prepareDelete({ ...entry, origin });
    view.confirm();
    http.expectNone(`${base}/delete`);
  });
  it('filters locally and retains the snapshot and timestamp when refresh fails', async () => {
    const fixture = enter(),
      view = fixture.componentInstance.state;
    const updated = view.updated();
    view.selectOrigin('ALL');
    http.expectNone(`${base}?origin=ALL`);
    expect(view.entries()).toEqual([entry]);
    view.refresh();
    view.selectOrigin('INTERNAL');
    expect(view.origin).toBe('ALL');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-origin="USER"]').disabled).toBe(true);
    http.expectOne(`${base}?origin=ALL`).error(new ProgressEvent('error'));
    expect(view.entries()).toEqual([entry]);
    expect(view.visibleOrigin()).toBe('ALL');
    expect(view.updated()).toBe(updated);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('desactualizados');
    expect(fixture.nativeElement.textContent).toContain('Origen de los datos visibles: Todos');
    view.selectOrigin('INTERNAL');
    expect(view.entries()).toEqual([]);
    expect(view.snapshot()).toEqual([entry]);
    http.expectNone(`${base}?origin=ALL`);
  });
  it('combines local origin and search filters without changing global counters or requesting data', async () => {
    const fixture = enter([
      entry,
      {
        ...entry,
        id: 'internal-42',
        origin: 'INTERNAL',
        command: 'backup.run',
        params: { target: 'Archive' },
      },
      { ...entry, id: 'future-42', origin: 'FUTURE', command: 'system.health' },
    ]);
    const view = fixture.componentInstance.state;
    const input = fixture.nativeElement.querySelector('#scheduler-search') as HTMLInputElement;
    input.value = '  ARCHIVE  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.entries()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Sin coincidencias');
    fixture.nativeElement.querySelector('[data-origin="INTERNAL"]').click();
    fixture.detectChanges();
    expect(view.entries()?.map((e) => e.id)).toEqual(['internal-42']);
    expect(fixture.nativeElement.querySelectorAll('thead th')).toHaveLength(6);
    expect(
      fixture.nativeElement.querySelector('[data-origin="INTERNAL"]').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      fixture.nativeElement.querySelector('[data-origin="ALL"] small').textContent.trim(),
    ).toBe('3');
    view.selectOrigin('ALL');
    view.search.set('FUTURE-42');
    fixture.detectChanges();
    expect(view.entries()?.map((e) => e.id)).toEqual(['future-42']);
    expect(fixture.nativeElement.querySelector('tbody button.danger')).toBeNull();
    view.search.set('SYSTEM.');
    expect(view.entries()?.map((e) => e.id)).toEqual([entry.id, 'future-42']);
    expect(view.summary()?.total).toBe(3);
    http.expectNone(`${base}?origin=ALL`);
    fixture.componentInstance.ionViewWillLeave();
    expect(view.search()).toBe('');
  });
  it('sorts queue admissions by instant, leaves unknown dates last and preserves snapshot order', () => {
    const data = [
      { ...entry, id: 'unknown', next_enqueue_at: 'unknown' },
      { ...entry, id: 'later', next_enqueue_at: '2030-01-01T12:00:00Z' },
      { ...entry, id: 'earlier', next_enqueue_at: '2030-01-01T12:30:00+02:00' },
      { ...entry, id: 'unknown-2', next_enqueue_at: 'unavailable' },
    ];
    const fixture = enter(data),
      view = fixture.componentInstance.state;
    expect(view.entries()?.map((e) => e.id)).toEqual(['earlier', 'later', 'unknown', 'unknown-2']);
    expect(view.snapshot()?.map((e) => e.id)).toEqual(data.map((e) => e.id));
    expect(fixture.nativeElement.querySelector('tbody tr').textContent).toContain('earlier');
  });
  it('keeps long identifiers and untrusted content accessible as text in the table', () => {
    const unsafe = '<script>alert(1)</script>';
    const id = 'long-identifier-'.repeat(30);
    const fixture = enter([{ ...entry, id, command: unsafe.repeat(20), params: { html: unsafe } }]);
    const table = fixture.nativeElement.querySelector('table');
    expect(table.querySelector('script')).toBeNull();
    expect(table.textContent).toContain(unsafe);
    expect(table.querySelector('.command-cell small').title).toBe(id);
    expect(table.querySelector('.command-cell small').textContent).toBe(id.slice(0, 8) + '…');
    expect(table.querySelector('pre').textContent).toContain(id);
    expect(table.querySelector('button.danger').getAttribute('aria-label')).toContain(id);
  });
  it('derives global indicators independently of the local filter and preserves them on failure', () => {
    const fixture = enter([
      entry,
      {
        ...entry,
        id: 'internal',
        origin: 'INTERNAL',
        schedule: { type: 'cron', expression: '* * * * *', timezone: 'UTC' },
        next_enqueue_at: '2029-01-01T00:00:00Z',
      },
      { ...entry, id: 'once', schedule: { type: 'once', at: '2031-01-01T00:00:00Z' } },
    ]);
    const view = fixture.componentInstance.state;
    expect(view.summary()).toMatchObject({
      total: 3,
      user: 2,
      internal: 1,
      recurring: 2,
      once: 1,
      next: { id: 'internal' },
    });
    view.selectOrigin('INTERNAL');
    expect(view.entries()?.map((e) => e.id)).toEqual(['internal']);
    expect(view.summary()?.total).toBe(3);
    const summary = view.summary();
    view.refresh();
    http.expectOne(`${base}?origin=ALL`).error(new ProgressEvent('error'));
    expect(view.summary()).toBe(summary);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Resumen anterior, desactualizado');
    view.ionViewWillLeave();
    expect(view.summary()).toBeNull();
  });
  it('distinguishes missing summary, failed initial load and a confirmed empty snapshot', () => {
    const fixture = TestBed.createComponent(Scheduler);
    const view = fixture.componentInstance.state;
    fixture.detectChanges();
    expect(view.summary()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-scheduler-indicators').textContent).toContain(
      'Sin lectura disponible',
    );
    view.ionViewWillEnter();
    http.expectOne(`${base}?origin=ALL`).error(new ProgressEvent('error'));
    expect(view.summary()).toBeNull();
    view.refresh();
    http.expectOne(`${base}?origin=ALL`).flush([]);
    expect(view.summary()).toMatchObject({
      total: 0,
      user: 0,
      internal: 0,
      recurring: 0,
      once: 0,
      next: null,
    });
  });
  it('cancels without a request and freezes the exact summary/body, blocking double clicks', () => {
    const fixture = enter(),
      view = fixture.componentInstance.state;
    view.prepareAdd();
    view.cancel();
    expect(view.form.params).toBe('{"nested":[1]}');
    http.expectNone(`${base}/add`);
    view.form.command = '<b>command</b>';
    view.prepareAdd();
    fixture.detectChanges();
    const dialog = dialogs.element!;
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
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
    expect(view.form).toEqual(emptyForm());
    expect(view.busy()).toBe(false);
  });
  it('deletes only USER entries with an independent id and refreshes the current filter', () => {
    const fixture = enter(),
      view = fixture.componentInstance.state;
    view.selectOrigin('ALL');
    http.expectNone(`${base}?origin=ALL`);
    const selected = structuredClone(entry);
    view.prepareDelete(selected);
    selected.id = 'changed';
    fixture.detectChanges();
    expect(dialogs.element!.textContent).toContain('no cancela comandos ya encolados');
    view.confirm();
    const request = http.expectOne(`${base}/delete`);
    expect(request.request.body).toEqual({ id: entry.id });
    request.flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([]);
    expect(view.resultLabel()).toBe('Programación eliminada');
  });
  it('keeps action success separate from refresh failure', () => {
    const view = enter().componentInstance.state;
    view.prepareAdd();
    view.confirm();
    http.expectOne(`${base}/add`).flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.result()).toEqual(entry);
    expect(view.resultLabel()).toBe('Programación creada');
    expect(view.error()).toBe('');
    expect(view.listError()).not.toBe('');
    expect(view.entries()).toEqual([entry]);
  });
  it('preserves form on rejection/uncertainty and never retries writes', () => {
    const view = enter().componentInstance.state;
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
      http.expectNone(`${base}?origin=ALL`);
    }
  });
  it('blocks invalid forms and invalidates confirmations on leave or session change', () => {
    const fixture = enter(),
      view = fixture.componentInstance.state;
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
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
    view.prepareDelete(entry);
    TestBed.inject(ThemeIdentity).clear();
    view.confirm();
    view.prepareDelete(entry);
    view.refresh();
    http.expectNone(`${base}/delete`);
    http.expectNone(`${base}?origin=ALL`);
    expect(view.entries()).toBeNull();
    expect(view.pending()).toBeNull();
  });
  it.each(['add', 'delete'] as const)(
    'recovers if the %s confirmation cannot open, without sending',
    (action) => {
      const fixture = enter(),
        view = fixture.componentInstance.state;
      const form = structuredClone(view.form);
      dialogs.open.mockImplementationOnce(() => {
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
      view = fixture.componentInstance.state;
    view.openCreate();
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
    const refresh = http.expectOne(`${base}?origin=ALL`);
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
      view = fixture.componentInstance.state;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('tbody button.danger') as HTMLButtonElement;
    trigger.focus();
    view.prepareDelete(entry);
    view.confirm();
    http.expectOne(`${base}/delete`).flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([]);
    TestBed.tick();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h2[tabindex="-1"]'));
  });
  it('blocks a manual refresh while confirming or sending a write', () => {
    const view = enter().componentInstance.state;
    view.prepareAdd();
    view.refresh();
    http.expectNone(`${base}?origin=ALL`);
    view.confirm();
    view.refresh();
    http.expectNone(`${base}?origin=ALL`);
    http.expectOne(`${base}/add`).flush(entry);
    http.expectOne(`${base}?origin=ALL`).flush([entry]);
  });
});
