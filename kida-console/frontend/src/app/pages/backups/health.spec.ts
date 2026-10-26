import { DeferBlockState, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { AuthService } from '../../auth/auth.service';
import { ChannelBusyError } from '../../services/arca-request.service';
import { BackupsService } from './backups.service';
import { Backups } from './backups';
import { BackupHealth } from './health';
import { healthBody, healthFailure } from './health-state';
import { HealthAction, HealthExecution, HealthHistoryRecord } from './health.models';
import { Observable } from 'rxjs';

const base = `${environment.apiBaseUrl}/backup`;
const run: HealthExecution = {
  run_id: 'run /?&+#ñ',
  definition: {
    id: 'health',
    name: '<img src=x onerror="alert(1)">',
    backup: { reference: 'daily', version: 'latest' },
    docker: { compose: 'compose.yml' },
  },
  definition_path: '/srv/health.toml',
  mode: 'FUTURE_MODE',
  state: 'FUTURE_STATE',
  diagnosis: {
    result: 'FUTURE_RESULT',
    summary: 'remote summary',
    complete: false,
    services: [{ service: 'app', result: 'DEGRADED', reasons: ['reason'] }],
    anomalies: ['anomaly'],
    evidence: [
      {
        observed_at: '2026-10-26T12:00:00Z',
        service: null,
        container_id: null,
        description: '<script>remote</script>',
        logs: '<img src=x onerror="alert(1)">',
        future: null,
      },
    ],
    future: null,
  },
  created_at: '2026-10-26T12:00:00Z',
  started_at: null,
  finished_at: null,
  artifact: null,
  compose_path: '/srv/compose.yml',
  compose_checksum: null,
  restore_dir: '/tmp/restored',
  project: { owner: 'kida', project: 'health' },
  services: [{ name: 'app', image: 'app:latest', replicas: 1 }],
  resources: [{ kind: 'volume', identity: 'kept-volume' }],
  cleanup: { state: 'ERROR', errors: ['resource retained'] },
  report_path: null,
  future: { value: 9007199254740992 },
};
const record: HealthHistoryRecord = {
  ...run,
  record_version: 1,
  restore_provenance: {
    path: '/tmp/restored',
    identity: { device: 9007199254740992, inode: 1 },
    future: null,
  },
  report_status: 'FUTURE_REPORT',
};
const operations = ['start', 'run', 'stop', 'delete'] as const;
const admitted = {
  run_id: run.run_id,
  state: 'FUTURE_QUEUED',
  execution_id: 'queue-id',
  cleanup: null,
  future: null,
};
const operationResponse = (action: HealthAction) =>
  action === 'start' || action === 'run' ? admitted : run;
const getUrl = (id = run.run_id) => `${base}/health/get?run_id=${encodeURIComponent(id)}`;
function setup() {
  TestBed.configureTestingModule({
    imports: [Backups, BackupHealth],
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

describe('Health basic contracts through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());
  it('reads root arrays and encoded IDs, preserving nulls, unknown states and fields', () => {
    const service = TestBed.inject(BackupsService),
      list = vi.fn(),
      detail = vi.fn();
    service.healthList().subscribe(list);
    const l = http.expectOne(`${base}/health`);
    expect(l.request.method).toBe('GET');
    expect(l.request.withCredentials).toBe(true);
    l.flush([record]);
    expect(list).toHaveBeenCalledWith([record]);
    service.healthGet(run.run_id).subscribe(detail);
    const d = http.expectOne(getUrl());
    expect(d.request.method).toBe('GET');
    expect(d.request.withCredentials).toBe(true);
    d.flush(run);
    expect(detail).toHaveBeenCalledWith(run);
    const actions = TestBed.inject(ArcaActionsService);
    for (const name of ['HEALTH_LIST', 'HEALTH_GET'])
      for (const suffix of ['REQUEST', 'RESPONSE', 'ERROR'])
        expect(actions.getDataSnapshot(`BACKUP_${name}_${suffix}`)).toBe('undefined');
  });
  it.each(['AUTOMATIC', 'MANUAL'] as const)(
    'creates %s with exact path and CSRF, without start/run',
    (mode) => {
      TestBed.inject(AuthService).csrfToken.set('csrf-health');
      const body = healthBody(' ./health/../app.toml ', mode),
        next = vi.fn();
      TestBed.inject(BackupsService).healthCreate(body).subscribe(next);
      const r = http.expectOne(`${base}/health/create`);
      expect(r.request.method).toBe('POST');
      expect(r.request.withCredentials).toBe(true);
      expect(r.request.headers.get('X-CSRF-Token')).toBe('csrf-health');
      expect(r.request.body).toEqual({ definition_path: ' ./health/../app.toml ', mode });
      r.flush(run);
      expect(next).toHaveBeenCalledWith(run);
      const actions = TestBed.inject(ArcaActionsService);
      for (const name of ['HEALTH_CREATE'])
        for (const suffix of ['REQUEST', 'RESPONSE', 'ERROR'])
          expect(actions.getDataSnapshot(`BACKUP_${name}_${suffix}`)).toBe('undefined');
      http.expectNone(`${base}/health/start`);
      http.expectNone(`${base}/health/run`);
    },
  );
  it.each(['list', 'get', 'create'] as const)(
    'drains abandoned %s and isolates a new session',
    (operation) => {
      const service = TestBed.inject(BackupsService);
      const send = (): Observable<unknown> =>
        operation === 'list'
          ? service.healthList()
          : operation === 'get'
            ? service.healthGet(run.run_id)
            : service.healthCreate({ definition_path: '/a', mode: 'MANUAL' });
      const url =
        operation === 'list'
          ? `${base}/health`
          : operation === 'get'
            ? getUrl()
            : `${base}/health/create`;
      const old = vi.fn(),
        fresh = vi.fn(),
        error = vi.fn();
      const subscription = send().subscribe(old),
        first = http.expectOne(url);
      subscription.unsubscribe();
      send().subscribe({ error });
      expect(error.mock.calls[0][0]).toBeInstanceOf(ChannelBusyError);
      http.expectNone(url);
      TestBed.inject(ThemeIdentity).begin();
      send().subscribe(fresh);
      const second = http.expectOne(url),
        data = operation === 'list' ? [record] : run;
      first.flush(data);
      expect(old).not.toHaveBeenCalled();
      expect(fresh).not.toHaveBeenCalled();
      second.flush(data);
      expect(fresh).toHaveBeenCalledWith(data);
    },
  );
  it.each(operations)(
    'sends %s with exact body, cookie/CSRF and an open response on an independent channel',
    (action) => {
      TestBed.inject(AuthService).csrfToken.set('operations-csrf');
      const service = TestBed.inject(BackupsService);
      const send = (): Observable<unknown> =>
        action === 'run'
          ? service.healthRun(' ./health/../automatic.toml ')
          : action === 'start'
            ? service.healthStart(run.run_id)
            : action === 'stop'
              ? service.healthStop(run.run_id)
              : service.healthDelete(run.run_id);
      const next = vi.fn();
      send().subscribe(next);
      const request = http.expectOne(`${base}/health/${action}`);
      expect(request.request.method).toBe('POST');
      expect(request.request.withCredentials).toBe(true);
      expect(request.request.headers.get('X-CSRF-Token')).toBe('operations-csrf');
      expect(request.request.body).toEqual(
        action === 'run'
          ? { definition_path: ' ./health/../automatic.toml ' }
          : { run_id: run.run_id },
      );
      const data = operationResponse(action);
      request.flush(data);
      expect(next).toHaveBeenCalledWith(data);
      for (const suffix of ['REQUEST', 'RESPONSE', 'ERROR'])
        expect(
          TestBed.inject(ArcaActionsService).getDataSnapshot(
            `BACKUP_HEALTH_${action.toUpperCase()}_${suffix}`,
          ),
        ).toBe('undefined');
    },
  );
  it.each(operations)(
    'drains abandoned %s, rejects busy reuse and isolates new sessions',
    (action) => {
      const service = TestBed.inject(BackupsService);
      const send = (): Observable<unknown> =>
        action === 'run'
          ? service.healthRun('/a')
          : action === 'start'
            ? service.healthStart(run.run_id)
            : action === 'stop'
              ? service.healthStop(run.run_id)
              : service.healthDelete(run.run_id);
      const old = vi.fn(),
        fresh = vi.fn(),
        error = vi.fn();
      const subscription = send().subscribe(old);
      const first = http.expectOne(`${base}/health/${action}`);
      subscription.unsubscribe();
      send().subscribe({ error });
      expect(error.mock.calls[0][0]).toBeInstanceOf(ChannelBusyError);
      http.expectNone(`${base}/health/${action}`);
      TestBed.inject(ThemeIdentity).begin();
      send().subscribe(fresh);
      const second = http.expectOne(`${base}/health/${action}`);
      first.flush(operationResponse(action));
      expect(old).not.toHaveBeenCalled();
      expect(fresh).not.toHaveBeenCalled();
      second.flush(operationResponse(action));
      expect(fresh).toHaveBeenCalledWith(operationResponse(action));
    },
  );
  it('validates mode and Unicode without interpreting host paths', () => {
    expect(healthBody('', 'MANUAL')).toEqual({ definition_path: '', mode: 'MANUAL' });
    expect(() => healthBody('\ud800', 'MANUAL')).toThrow('Unicode');
    expect(() => healthBody('/a', 'manual' as never)).toThrow('modo');
    expect(healthFailure(new HttpErrorResponse({ status: 504 }), true)).toContain(
      'creación de Health',
    );
    expect(healthFailure(new HttpErrorResponse({ status: 401 }))).toContain('sesión');
  });
});

describe('Health basic state and page integration', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
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
  function enter(rows = [record]) {
    const fixture = TestBed.createComponent(Backups);
    fixture.detectChanges();
    fixture.componentInstance.ionViewWillEnter();
    http.expectOne(`${base}/health/reports`).flush([]);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush(rows);
    return fixture;
  }
  function selection(page: Backups) {
    page.health.select(run.run_id);
    http.expectOne(getUrl()).flush(run);
  }
  it('loads once on entry, without polling, and distinguishes initial error from empty', () => {
    const fixture = TestBed.createComponent(Backups),
      page = fixture.componentInstance;
    fixture.detectChanges();
    page.ionViewWillEnter();
    http.expectOne(`${base}/health/reports`).flush([]);
    page.health.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(page.health.loading()).toBe(true);
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(page.health.entries()).toBeNull();
    expect(page.health.updated()).toBeNull();
    expect(page.health.listError()).not.toBe('');
    page.health.refresh();
    http.expectOne(`${base}/health`).flush([]);
    expect(page.health.entries()).toEqual([]);
    expect(page.health.listError()).toBe('');
    http.expectNone(`${base}/health`);
  });
  it('keeps previous history/detail on failure, refreshes selected detail and clears vanished selection', () => {
    const page = enter().componentInstance,
      health = page.health;
    selection(page);
    health.refresh();
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(health.entries()).toEqual([record]);
    expect(health.detail()).toEqual(run);
    health.refresh();
    http.expectOne(`${base}/health`).flush([{ ...record, report_status: 'NEW_REPORT' }]);
    http.expectOne(getUrl()).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(health.detail()).toEqual(run);
    expect(health.detailError()).not.toBe('');
    expect(health.selectedHistory()?.report_status).toBe('NEW_REPORT');
    health.refresh();
    http.expectOne(`${base}/health`).flush([record]);
    http.expectOne(getUrl()).flush({ ...run, state: 'NEW_STATE' });
    expect(health.detail()?.state).toBe('NEW_STATE');
    expect(health.detailError()).toBe('');
    health.refresh();
    http.expectOne(`${base}/health`).flush([]);
    expect(health.selectedId()).toBeNull();
    expect(health.detail()).toBeNull();
    expect(health.selectedHistory()).toBeNull();
  });
  it('never shows another selection detail and prevents overlapping detail reads', () => {
    const page = enter([record, { ...record, run_id: 'second' }]).componentInstance,
      health = page.health;
    selection(page);
    health.select('second');
    health.select(run.run_id);
    expect(health.selectedId()).toBe('second');
    expect(health.detail()).toBeNull();
    const r = http.expectOne(getUrl('second'));
    http.expectNone(getUrl());
    r.flush({}, { status: 502, statusText: 'Rejected' });
    expect(health.detail()).toBeNull();
    expect(health.detailError()).not.toBe('');
  });
  it.each(['AUTOMATIC', 'MANUAL'] as const)(
    'creates %s once, resets form only on success, refreshes list and detail',
    (mode) => {
      const page = enter().componentInstance,
        health = page.health;
      health.definitionPath = ' ./a.toml ';
      health.mode = mode;
      health.create();
      health.create();
      health.refresh();
      page.create();
      page.refresh();
      const r = http.expectOne(`${base}/health/create`);
      expect(r.request.body).toEqual({ definition_path: ' ./a.toml ', mode });
      http.expectNone(`${base}/config/create`);
      http.expectNone(`${base}/config`);
      r.flush(run);
      expect(health.result()).toEqual(run);
      expect(health.definitionPath).toBe('');
      expect(health.mode).toBe('MANUAL');
      health.create();
      http.expectNone(`${base}/health/create`);
      http.expectOne(`${base}/health`).flush([record]);
      http.expectOne(getUrl()).flush(run);
      expect(health.selectedId()).toBe(run.run_id);
      expect(health.detail()).toEqual(run);
      expect(health.occupied()).toBe(false);
      http.expectNone(`${base}/health/start`);
      http.expectNone(`${base}/health/run`);
    },
  );
  it('keeps success separate from failed post-create refresh and keeps selected returned detail', () => {
    const health = enter().componentInstance.health;
    health.definitionPath = '/a';
    health.create();
    http.expectOne(`${base}/health/create`).flush({ ...run, run_id: 'new' });
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(health.result()?.run_id).toBe('new');
    expect(health.detail()?.run_id).toBe('new');
    expect(health.listError()).not.toBe('');
    expect(health.selectedHistory()).toBeNull();
  });
  it.each([
    [422, undefined, 'Validación'],
    [502, 'core_error', 'CORE rechazó'],
    [503, 'core_unavailable', 'Sin conexión'],
    [504, 'core_timeout', 'No se pudo confirmar'],
    [0, undefined, 'No se pudo confirmar'],
  ] as const)(
    'retains failed form %s, classifies rejection/uncertainty and never retries',
    (status, code, text) => {
      const health = enter().componentInstance.health;
      health.definitionPath = ' /a ';
      health.mode = 'AUTOMATIC';
      health.create();
      const r = http.expectOne(`${base}/health/create`);
      if (status === 0) r.error(new ProgressEvent('error'));
      else r.flush({ detail: { code } }, { status, statusText: 'Failed' });
      expect(health.definitionPath).toBe(' /a ');
      expect(health.mode).toBe('AUTOMATIC');
      expect(health.result()).toBeNull();
      expect(health.error() + health.uncertainties().join()).toContain(text);
      expect(health.writing()).toBe(false);
      http.expectNone(`${base}/health/create`);
      http.expectNone(`${base}/health`);
    },
  );
  it('retains uncertain creation after refresh and later success', () => {
    const health = enter().componentInstance.health;
    health.definitionPath = ' /a ';
    health.mode = 'AUTOMATIC';
    health.create();
    http.expectOne(`${base}/health/create`).flush({}, { status: 504, statusText: 'Timeout' });
    const warning = health.uncertainties()[0];
    expect(warning).toContain(' /a ');
    expect(warning).toContain('AUTOMATIC');
    health.refresh();
    http.expectOne(`${base}/health`).flush([record]);
    expect(health.uncertainties()).toEqual([warning]);
    health.create();
    http.expectOne(`${base}/health/create`).flush(run);
    http.expectOne(`${base}/health`).flush([record]);
    http.expectOne(getUrl()).flush(run);
    expect(health.uncertainties()).toEqual([warning]);
  });
  it('blocks Health while a configuration confirmation/write is active and while configurations refresh', () => {
    const page = enter().componentInstance,
      health = page.health;
    page.prepare('run', { id: 'backup', name: 'name' } as never);
    health.create();
    health.refresh();
    health.select(run.run_id);
    expect(health.disabled()).toBe(true);
    http.expectNone(`${base}/health/create`);
    http.expectNone(`${base}/health`);
    http.expectNone(getUrl());
    page.confirm();
    health.create();
    http.expectNone(`${base}/health/create`);
    http.expectOne(`${base}/run`).flush({ state: 'QUEUED', execution_id: 'e' });
    health.create();
    http.expectNone(`${base}/health/create`);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(health.disabled()).toBe(false);
  });
  it('blocks configuration operations and Health writes during Health reads', () => {
    const page = enter().componentInstance;
    page.health.select(run.run_id);
    page.prepare('run', { id: 'b', name: 'b' } as never);
    page.create();
    page.refresh();
    page.health.create();
    expect(page.pending()).toBeNull();
    http.expectNone(`${base}/config/create`);
    http.expectNone(`${base}/config`);
    http.expectNone(`${base}/health/create`);
    http.expectOne(getUrl()).flush(run);
  });
  it('rejects invalid form before sending', () => {
    const health = enter().componentInstance.health;
    health.definitionPath = '\ud800';
    health.create();
    expect(health.error()).toContain('Unicode');
    http.expectNone(`${base}/health/create`);
  });
  it.each(['list', 'get', 'create'] as const)(
    'ignores late %s on leave, handles channel busy on re-entry, then recovers',
    (operation) => {
      const page = enter().componentInstance,
        health = page.health;
      const send = () =>
        operation === 'list'
          ? health.refresh()
          : operation === 'get'
            ? health.select(run.run_id)
            : health.create();
      const url =
        operation === 'list'
          ? `${base}/health`
          : operation === 'get'
            ? getUrl()
            : `${base}/health/create`;
      send();
      const old = http.expectOne(url);
      page.ionViewWillLeave();
      page.ionViewWillEnter();
      http.expectOne(`${base}/health/reports`).flush([]);
      http.expectOne(`${base}/config`).flush({ backups: [] });
      if (operation !== 'list') {
        http.expectOne(`${base}/health`).flush([record]);
        send();
      }
      expect(health.listError() + health.detailError() + health.error()).toContain('pendiente');
      old.flush(operation === 'list' ? [record] : run);
      expect(health.result()).toBeNull();
      expect(health.detail()).toBeNull();
      send();
      http.expectOne(url).flush(operation === 'list' ? [record] : run);
      if (operation === 'create') {
        http.expectOne(`${base}/health`).flush([record]);
        http.expectOne(getUrl()).flush(run);
      }
    },
  );
  it('ignores an old session result while a new session create is pending', () => {
    const page = enter().componentInstance,
      health = page.health;
    health.create();
    const old = http.expectOne(`${base}/health/create`);
    TestBed.inject(ThemeIdentity).begin();
    page.ionViewWillEnter();
    http.expectOne(`${base}/health/reports`).flush([]);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    health.create();
    const fresh = http.expectOne(`${base}/health/create`);
    old.flush(run);
    expect(health.result()).toBeNull();
    expect(health.writing()).toBe(true);
    fresh.flush(run);
    http.expectOne(`${base}/health`).flush([record]);
    http.expectOne(getUrl()).flush(run);
    expect(health.result()).toEqual(run);
  });
  async function healthView() {
    const page = enter().componentInstance;
    selection(page);
    const fixture = TestBed.createComponent(BackupHealth);
    fixture.componentRef.setInput('state', page.health);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return { page, health: page.health, fixture, component: fixture.componentInstance };
  }
  it.each(operations)(
    'freezes %s, locks both panels, cancels, confirms once and refreshes',
    async (action) => {
      const { page, health, fixture, component } = await healthView();
      health.automaticPath = ' ./exact/../automatic.toml ';
      component.prepare(action);
      fixture.detectChanges();
      const pending = health.pending();
      expect(Object.isFrozen(pending)).toBe(true);
      expect(pending?.target).toBe(
        action === 'run' ? health.automaticPath : `${run.definition.name} (${run.run_id})`,
      );
      expect(health.disabled()).toBe(true);
      page.prepare('run', { id: 'b', name: 'b' } as never);
      page.create();
      page.refresh();
      health.create();
      health.refresh();
      health.select('other');
      expect(page.pending()).toBeNull();
      http.expectNone(`${base}/config/create`);
      http.expectNone(`${base}/config`);
      http.expectNone(`${base}/health/create`);
      http.expectNone(`${base}/health`);
      const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      const event = new Event('cancel', { cancelable: true });
      dialog.dispatchEvent(event);
      fixture.detectChanges();
      expect(event.defaultPrevented).toBe(true);
      expect(dialog.open).toBe(false);
      expect(health.pending()).toBeNull();
      expect(health.automaticPath).toBe(' ./exact/../automatic.toml ');
      http.expectNone(`${base}/health/${action}`);
      component.prepare(action);
      // Form/detail mutation after opening cannot change the captured target.
      health.automaticPath = '/changed';
      health.detail.set({
        ...run,
        run_id: 'changed',
        definition: { ...run.definition, name: 'changed' },
      });
      fixture.detectChanges();
      expect(dialog.textContent).toContain(pending!.target);
      component.confirm();
      component.confirm();
      health.confirm();
      const request = http.expectOne(`${base}/health/${action}`);
      expect(request.request.body).toEqual(
        action === 'run'
          ? { definition_path: ' ./exact/../automatic.toml ' }
          : { run_id: run.run_id },
      );
      expect(dialog.open).toBe(false);
      request.flush(operationResponse(action));
      expect(health.result()).toEqual(operationResponse(action));
      if (action === 'run') expect(health.automaticPath).toBe('');
      http.expectOne(`${base}/health`).flush([record]);
      http.expectOne(getUrl()).flush(run);
      expect(health.selectedId()).toBe(run.run_id);
      expect(health.occupied()).toBe(false);
      fixture.detectChanges();
      const status = fixture.nativeElement.querySelector('[role="status"]').textContent;
      expect(status).toContain(
        action === 'start' || action === 'run' ? 'solicitud admitida' : 'Revisa cleanup',
      );
      if (action === 'start' || action === 'run') {
        expect(status).toContain('queue-id');
        expect(status).toContain('FUTURE_QUEUED');
      }
    },
  );
  it.each(operations)('fails closed when the %s dialog cannot open', async (action) => {
    const { health, fixture, component } = await healthView();
    vi.spyOn(fixture.nativeElement.querySelector('dialog'), 'showModal').mockImplementation(() => {
      throw new Error();
    });
    health.automaticPath = '/keep';
    component.prepare(action);
    component.confirm();
    expect(health.pending()).toBeNull();
    expect(health.disabled()).toBe(false);
    expect(health.error()).toContain('abrir la confirmación');
    expect(health.automaticPath).toBe('/keep');
    http.expectNone(`${base}/health/${action}`);
  });
  it.each(
    operations.flatMap((action) =>
      [422, 502, 503, 504, 0].map((status) => [action, status] as const),
    ),
  )(
    'handles %s failure %s and preserves target, path and uncertainty through later writes',
    async (action, status) => {
      const { health, component } = await healthView();
      health.automaticPath = ' /keep ';
      component.prepare(action);
      component.confirm();
      const request = http.expectOne(`${base}/health/${action}`);
      if (status === 0) request.error(new ProgressEvent('error'));
      else
        request.flush(
          {
            detail: {
              code:
                status === 502
                  ? 'core_error'
                  : status === 503
                    ? 'core_unavailable'
                    : status === 504
                      ? 'core_timeout'
                      : undefined,
            },
          },
          { status, statusText: 'Failed' },
        );
      expect(health.automaticPath).toBe(' /keep ');
      expect(health.result()).toBeNull();
      expect(health.writing()).toBe(false);
      expect(health.error() + health.uncertainties().join()).toContain(
        status === 422
          ? 'Validación'
          : status === 502
            ? 'CORE rechazó'
            : status === 503
              ? 'Sin conexión'
              : 'No se pudo confirmar',
      );
      if (status === 504 || status === 0) {
        const warning = health.uncertainties()[0];
        expect(warning).toContain(
          action === 'run' ? ' /keep ' : `${run.definition.name} (${run.run_id})`,
        );
        expect(warning).toContain(
          action === 'run'
            ? 'Ejecutar Health automático'
            : action === 'start'
              ? 'Iniciar Health'
              : action === 'stop'
                ? 'Detener Health'
                : 'Eliminar Health',
        );
        health.refresh();
        http.expectOne(`${base}/health`).flush([record]);
        http.expectOne(getUrl()).flush(run);
        health.create();
        http.expectOne(`${base}/health/create`).flush(run);
        http.expectOne(`${base}/health`).flush([record]);
        http.expectOne(getUrl()).flush(run);
        expect(health.uncertainties()).toEqual([warning]);
      }
      http.expectNone(`${base}/health/${action}`);
    },
  );
  it.each(['start', 'run'] as const)(
    'selects the returned %s ID independently from the queued execution ID',
    async (action) => {
      const { health, component } = await healthView();
      component.prepare(action);
      component.confirm();
      http
        .expectOne(`${base}/health/${action}`)
        .flush({ ...admitted, run_id: 'returned-health', execution_id: 'different-queue-id' });
      expect(health.selectedId()).toBe('returned-health');
      expect(health.detail()).toBeNull();
      http.expectOne(`${base}/health`).flush([{ ...record, run_id: 'returned-health' }]);
      http.expectOne(getUrl('returned-health')).flush({ ...run, run_id: 'returned-health' });
      expect(health.detail()?.run_id).toBe('returned-health');
      expect(health.queuedResult()?.execution_id).toBe('different-queue-id');
    },
  );
  it('keeps deletion response and cleanup after successful history removes selection', async () => {
    const { health, fixture, component } = await healthView();
    component.prepare('delete');
    component.confirm();
    http.expectOne(`${base}/health/delete`).flush(run);
    http.expectOne(`${base}/health`).flush([]);
    expect(health.selectedId()).toBeNull();
    expect(health.detail()).toBeNull();
    expect(health.result()).toEqual(run);
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[role="status"]').textContent;
    expect(status).toContain('resource retained');
    expect(status).toContain('kept-volume');
    expect(status).toContain('ERROR');
  });
  it.each(operations)(
    'keeps %s write success independent of a failed history read',
    async (action) => {
      const { health, component } = await healthView();
      component.prepare(action);
      component.confirm();
      http.expectOne(`${base}/health/${action}`).flush(operationResponse(action));
      http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
      expect(health.result()).toEqual(operationResponse(action));
      expect(health.listError()).not.toBe('');
      expect(health.selectedId()).toBe(run.run_id);
    },
  );
  it.each(operations)(
    'ignores late %s across exit, busy re-entry and new session',
    async (action) => {
      const { page, health, component } = await healthView();
      const send = () => {
        health.prepare(action);
        health.confirm();
      };
      component.prepare(action);
      component.confirm();
      const old = http.expectOne(`${base}/health/${action}`);
      page.ionViewWillLeave();
      page.ionViewWillEnter();
      http.expectOne(`${base}/health/reports`).flush([]);
      http.expectOne(`${base}/config`).flush({ backups: [] });
      http.expectOne(`${base}/health`).flush([record]);
      selection(page);
      send();
      expect(health.error()).toContain('pendiente');
      http.expectNone(`${base}/health/${action}`);
      TestBed.inject(ThemeIdentity).begin();
      page.ionViewWillEnter();
      http.expectOne(`${base}/health/reports`).flush([]);
      http.expectOne(`${base}/config`).flush({ backups: [] });
      http.expectOne(`${base}/health`).flush([record]);
      selection(page);
      send();
      const fresh = http.expectOne(`${base}/health/${action}`);
      old.flush(operationResponse(action));
      expect(health.result()).toBeNull();
      expect(health.writing()).toBe(true);
      fresh.flush(operationResponse(action));
      http.expectOne(`${base}/health`).flush([record]);
      http.expectOne(getUrl()).flush(run);
      expect(health.result()).toEqual(operationResponse(action));
    },
  );
  it.each(['leave', 'session'] as const)(
    'clears open confirmation on %s and never dispatches it later',
    async (reason) => {
      const { page, health, fixture, component } = await healthView();
      health.automaticPath = '/private';
      component.prepare('run');
      fixture.detectChanges();
      const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      if (reason === 'leave') page.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      fixture.detectChanges();
      expect(dialog.open).toBe(false);
      expect(dialog.textContent).not.toContain('/private');
      expect(health.pending()).toBeNull();
      expect(health.automaticPath).toBe('');
      component.confirm();
      http.expectNone(`${base}/health/run`);
    },
  );
  it('rejects invalid automatic Unicode without opening or dispatching', async () => {
    const { health, fixture, component } = await healthView();
    health.automaticPath = '\ud800';
    component.prepare('run');
    component.confirm();
    expect(health.error()).toContain('Unicode');
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    http.expectNone(`${base}/health/run`);
  });
  it.each([200, 502, 504])(
    'traps dialog keyboard and restores operation focus after %s',
    async (status) => {
      const { health, fixture, component } = await healthView();
      const trigger = [...fixture.nativeElement.querySelectorAll('button')].find(
        (b: any) => b.textContent.trim() === 'Iniciar Health',
      ) as HTMLButtonElement;
      trigger.focus();
      component.prepare('start');
      fixture.detectChanges();
      const buttons = fixture.nativeElement.querySelectorAll('dialog button');
      expect(document.activeElement).toBe(buttons[0]);
      buttons[0].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(document.activeElement).toBe(buttons[1]);
      buttons[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
      expect(document.activeElement).toBe(buttons[0]);
      component.cancel();
      TestBed.tick();
      await fixture.whenStable();
      expect(document.activeElement).toBe(trigger);
      component.prepare('start');
      component.confirm();
      fixture.detectChanges();
      const request = http.expectOne(`${base}/health/start`);
      if (status === 200) {
        request.flush(admitted);
        fixture.detectChanges();
        http.expectOne(`${base}/health`).flush([record]);
        http.expectOne(getUrl()).flush(run);
      } else
        request.flush(
          { detail: { code: status === 502 ? 'core_error' : 'core_timeout' } },
          { status, statusText: 'Failed' },
        );
      TestBed.tick();
      await fixture.whenStable();
      expect(document.activeElement).toBe(
        status === 200 ? fixture.nativeElement.querySelector('button[type="submit"]') : trigger,
      );
      expect(health.disabled()).toBe(false);
    },
  );
  it('renders safe details, cleanup, provenance and full JSON including future fields', async () => {
    const page = enter().componentInstance;
    selection(page);
    const fixture = TestBed.createComponent(BackupHealth);
    fixture.componentRef.setInput('state', page.health);
    fixture.detectChanges();
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    for (const value of [
      'FUTURE_STATE',
      'FUTURE_REPORT',
      'Evidencias',
      'kept-volume',
      'resource retained',
      'Procedencia',
      'Precisión limitada',
      '<script>remote</script>',
      'future',
      'validación funcional',
    ])
      expect(text).toContain(value);
    expect(fixture.nativeElement.querySelector('img,script')).toBeNull();
    page.health.refresh();
    http.expectOne(`${base}/health`).flush([record]);
    http.expectOne(getUrl()).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Detalle anterior, desactualizado');
  });
  it.each([200, 502, 504])(
    'restores create focus after response %s and all dependent reads',
    async (status) => {
      const page = enter().componentInstance;
      const fixture = TestBed.createComponent(BackupHealth);
      fixture.componentRef.setInput('state', page.health);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      const trigger = fixture.nativeElement.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      trigger.focus();
      fixture.componentInstance.create();
      fixture.detectChanges();
      expect(trigger.matches(':disabled')).toBe(true);
      const request = http.expectOne(`${base}/health/create`);
      if (status === 200) {
        request.flush(run);
        fixture.detectChanges();
        expect(trigger.matches(':disabled')).toBe(true);
        http.expectOne(`${base}/health`).flush([record]);
        http.expectOne(getUrl()).flush(run);
      } else
        request.flush(
          { detail: { code: status === 502 ? 'core_error' : 'core_timeout' } },
          { status, statusText: 'Failed' },
        );
      TestBed.tick();
      await fixture.whenStable();
      expect(trigger.matches(':disabled')).toBe(false);
      expect(document.activeElement).toBe(trigger);
    },
  );
  it('clears Health data and cached form DOM after a detached page session change', async () => {
    const fixture = enter(),
      page = fixture.componentInstance;
    selection(page);
    fixture.detectChanges();
    const blocks = await fixture.getDeferBlocks();
    await blocks[0].render(DeferBlockState.Complete);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('#health-definition') as HTMLInputElement;
    input.value = ' cached health ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(page.health.definitionPath).toBe(' cached health ');
    page.health.automaticPath = '/cached/automatic';
    const healthComponent = fixture.debugElement.query(
      (element) => element.componentInstance instanceof BackupHealth,
    ).componentInstance as BackupHealth;
    healthComponent.prepare('run');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-backup-health dialog').open).toBe(true);
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(page.health.entries()).toBeNull();
    expect(page.health.detail()).toBeNull();
    expect(page.health.selectedId()).toBeNull();
    expect(page.health.definitionPath).toBe('');
    expect(page.health.automaticPath).toBe('');
    expect(page.health.pending()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-backup-health')).toBeNull();
  });
});
