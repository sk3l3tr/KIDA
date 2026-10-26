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
import { HealthExecution, HealthHistoryRecord } from './health.models';
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
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(page.health.entries()).toBeNull();
    expect(page.health.detail()).toBeNull();
    expect(page.health.selectedId()).toBeNull();
    expect(page.health.definitionPath).toBe('');
    expect(fixture.nativeElement.querySelector('app-backup-health')).toBeNull();
  });
});
