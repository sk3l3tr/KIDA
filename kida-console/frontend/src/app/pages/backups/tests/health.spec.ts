import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { EMPTY } from 'rxjs';
import { BackupsService } from '../services/backups.service';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { Backups } from '../backups';
import { BackupHealth } from '../tabs/backup-health/health';
import { healthBody } from '../utils/backups-form';
import { healthDate, healthFailure } from '../utils/backups-presentation';
import { HealthAction, HealthExecution, HealthHistoryRecord } from '../utils/health.models';

let dialogs: ReturnType<typeof mockArcaDialogs>;
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
          modals: inject(ArcaModalService),
        }),
      },
      { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(Backups, {
    set: {
      imports: [BackupHealth],
      template: '@if (state.active()) { <app-backup-health /> }',
    },
  });
  TestBed.overrideComponent(SidePanel, {
    set: { template: '@if (open()) { <ng-content /><ng-content select="[panel-actions]" /> }' },
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  dialogs = mockArcaDialogs();
  return TestBed.inject(HttpTestingController);
}

describe('Health basic contracts through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });

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
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
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
    page.state.openHealthDetail(run.run_id);
    http.expectOne(getUrl()).flush(run);
  }
  it('loads once on entry, without polling, and distinguishes initial error from empty', () => {
    const fixture = TestBed.createComponent(Backups),
      page = fixture.componentInstance;
    fixture.detectChanges();
    page.ionViewWillEnter();
    http.expectOne(`${base}/health/reports`).flush([]);
    page.state.health.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(page.state.health.loading()).toBe(true);
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(page.state.health.entries()).toBeNull();
    expect(page.state.health.updated()).toBeNull();
    expect(page.state.health.listError()).not.toBe('');
    page.state.health.refresh();
    http.expectOne(`${base}/health`).flush([]);
    expect(page.state.health.entries()).toEqual([]);
    expect(page.state.health.listError()).toBe('');
    http.expectNone(`${base}/health`);
  });
  it('keeps previous history/detail on failure, refreshes selected detail and clears vanished selection', () => {
    const page = enter().componentInstance,
      health = page.state.health;
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
      health = page.state.health;
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
        health = page.state.health;
      health.definitionPath = ' ./a.toml ';
      health.mode = mode;
      health.create();
      health.create();
      health.refresh();
      page.state.configurations.create();
      page.state.configurations.refresh();
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
    const health = enter().componentInstance.state.health;
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
      const health = enter().componentInstance.state.health;
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
    const health = enter().componentInstance.state.health;
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
      health = page.state.health;
    page.state.configurations.prepare('run', { id: 'backup', name: 'name' } as never);
    health.create();
    health.refresh();
    health.select(run.run_id);
    expect(health.disabled()).toBe(true);
    http.expectNone(`${base}/health/create`);
    http.expectNone(`${base}/health`);
    http.expectNone(getUrl());
    page.state.configurations.confirm();
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
    page.state.health.select(run.run_id);
    page.state.configurations.prepare('run', { id: 'b', name: 'b' } as never);
    page.state.configurations.create();
    page.state.configurations.refresh();
    page.state.health.create();
    expect(page.state.configurations.pending()).toBeNull();
    http.expectNone(`${base}/config/create`);
    http.expectNone(`${base}/config`);
    http.expectNone(`${base}/health/create`);
    http.expectOne(getUrl()).flush(run);
  });
  it('rejects invalid form before sending', () => {
    const health = enter().componentInstance.state.health;
    health.definitionPath = '\ud800';
    health.create();
    expect(health.error()).toContain('Unicode');
    http.expectNone(`${base}/health/create`);
  });

  async function healthView() {
    const fixture = enter();
    const page = fixture.componentInstance;
    selection(page);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return {
      page,
      health: page.state.health,
      fixture,
      component: fixture.debugElement.query(
        (element) => element.componentInstance instanceof BackupHealth,
      ).componentInstance as BackupHealth,
    };
  }
  async function formView(mode: 'health-create' | 'health-run') {
    const fixture = enter();
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const label = mode === 'health-create' ? 'Crear Health' : 'Ejecutar Health automático';
    const trigger = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: any) => button.textContent.trim() === label,
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const page = fixture.componentInstance;
    const component = fixture.debugElement.query(By.directive(BackupHealth))
      .componentInstance as BackupHealth;
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    return { fixture, page, component, panel, trigger, health: page.state.health };
  }

  it('uses the shared dialog for Health with its exact target and warning', async () => {
    const { component, health } = await healthView();
    component.prepare('stop');
    expect(dialogs.config?.title).toBe('Confirmar operación de Health');
    expect(dialogs.element?.textContent).toContain(run.run_id);
    expect(dialogs.element?.textContent).toContain('CORE decide la limpieza');
    dialogs.choose('cancel');
    expect(health.pending()).toBeNull();
    http.expectNone(`${base}/health/stop`);
  });
  it.each([
    ['Iniciar Health', 'start'],
    ['Detener Health', 'stop'],
    ['Eliminar Health', 'delete'],
  ] as const)('opens confirmation from the inspector action %s', async (label, action) => {
    const { health, fixture } = await healthView();
    const detail = fixture.nativeElement.querySelector('[panel-actions]') as HTMLElement;
    const button = [...detail.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )!;
    button.click();
    expect(health.pending()?.action).toBe(action);
    expect(dialogs.element?.textContent).toContain(run.run_id);
    dialogs.choose('cancel');
    expect(health.pending()).toBeNull();
    http.expectNone(`${base}/health/${action}`);
  });
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
      page.state.configurations.prepare('run', { id: 'b', name: 'b' } as never);
      page.state.configurations.create();
      page.state.configurations.refresh();
      health.create();
      health.refresh();
      health.select('other');
      expect(page.state.configurations.pending()).toBeNull();
      http.expectNone(`${base}/config/create`);
      http.expectNone(`${base}/config`);
      http.expectNone(`${base}/health/create`);
      http.expectNone(`${base}/health`);
      expect(dialogs.element).not.toBeNull();
      dialogs.dismiss();
      fixture.detectChanges();
      expect(dialogs.element).toBeNull();
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
      expect(dialogs.element!.textContent).toContain(pending!.target);
      component.confirm();
      component.confirm();
      health.confirm();
      const request = http.expectOne(`${base}/health/${action}`);
      expect(request.request.body).toEqual(
        action === 'run'
          ? { definition_path: ' ./exact/../automatic.toml ' }
          : { run_id: run.run_id },
      );
      expect(dialogs.element).toBeNull();
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
    const { health, component } = await healthView();
    dialogs.open.mockImplementationOnce(() => {
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

  it.each(['leave', 'session'] as const)(
    'clears open confirmation on %s and never dispatches it later',
    async (reason) => {
      const { page, health, fixture, component } = await healthView();
      health.automaticPath = '/private';
      component.prepare('run');
      fixture.detectChanges();
      const dialog = dialogs.element!;
      expect(dialogs.element).not.toBeNull();
      if (reason === 'leave') page.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      fixture.detectChanges();
      expect(dialogs.element).toBeNull();
      expect(dialog.textContent).not.toContain('/private');
      expect(health.pending()).toBeNull();
      expect(health.automaticPath).toBe('');
      component.confirm();
      http.expectNone(`${base}/health/run`);
    },
  );
  it('rejects invalid automatic Unicode without opening or dispatching', async () => {
    const { health, component } = await healthView();
    health.automaticPath = '\ud800';
    component.prepare('run');
    component.confirm();
    expect(health.error()).toContain('Unicode');
    expect(dialogs.element !== null).toBe(false);
    http.expectNone(`${base}/health/run`);
  });
  it.each([200, 502, 504])(
    'focuses Cancel and restores operation focus after %s',
    async (status) => {
      const { health, fixture, component } = await healthView();
      const trigger = [...fixture.nativeElement.querySelectorAll('button')].find(
        (b: any) => b.textContent.trim() === 'Iniciar Health',
      ) as HTMLButtonElement;
      trigger.focus();
      component.prepare('start');
      fixture.detectChanges();
      TestBed.tick();
      expect(document.activeElement).toBe(
        dialogs.element!.querySelector('[data-dialog-option="cancel"]'),
      );
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
        status === 200 ? component.panelHeading()?.nativeElement : trigger,
      );
      expect(health.disabled()).toBe(false);
    },
  );
  it('renders safe details, cleanup, provenance and full JSON including future fields', async () => {
    const fixture = enter();
    const page = fixture.componentInstance;
    selection(page);
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
    page.state.health.refresh();
    http.expectOne(`${base}/health`).flush([record]);
    http.expectOne(getUrl()).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Detalle anterior, desactualizado');
  });
  it.each([200, 502, 504])(
    'restores create focus after response %s and all dependent reads',
    async (status) => {
      const { fixture, component, panel, trigger: opener } = await formView('health-create');
      const trigger = fixture.nativeElement.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      trigger.focus();
      component.create();
      fixture.detectChanges();
      expect(trigger.matches(':disabled')).toBe(true);
      const request = http.expectOne(`${base}/health/create`);
      if (status === 200) {
        request.flush(run);
        fixture.detectChanges();
        expect(panel.open()).toBe(false);
        expect(fixture.nativeElement.querySelector('#health-create-form')).toBeNull();
        panel.didDismiss();
        await new Promise((resolve) => setTimeout(resolve));
        expect(document.activeElement).toBe(component.listHeading()?.nativeElement);
        http.expectOne(`${base}/health`).flush([record]);
        http.expectNone(getUrl());
      } else {
        request.flush(
          { detail: { code: status === 502 ? 'core_error' : 'core_timeout' } },
          { status, statusText: 'Failed' },
        );
      }
      TestBed.tick();
      await fixture.whenStable();
      expect(component.state.disabled()).toBe(false);
      if (status === 200) {
        expect(opener.disabled).toBe(false);
        expect(document.activeElement).toBe(component.listHeading()?.nativeElement);
      } else {
        expect(trigger.matches(':disabled')).toBe(false);
        expect(document.activeElement).toBe(trigger);
      }
    },
  );
  it('clears Health data and cached form DOM after a detached page session change', async () => {
    const fixture = enter(),
      page = fixture.componentInstance;
    selection(page);
    fixture.detectChanges();
    await fixture.whenStable();
    page.state.openHealthForm('health-create');
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('#health-definition') as HTMLInputElement;
    input.value = ' cached health ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(page.state.health.definitionPath).toBe(' cached health ');
    page.state.health.automaticPath = '/cached/automatic';
    const healthComponent = fixture.debugElement.query(
      (element) => element.componentInstance instanceof BackupHealth,
    ).componentInstance as BackupHealth;
    page.state.openHealthForm('health-run');
    fixture.detectChanges();
    healthComponent.prepare('run');
    fixture.detectChanges();
    expect(dialogs.element !== null).toBe(true);
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(page.state.health.entries()).toBeNull();
    expect(page.state.health.detail()).toBeNull();
    expect(page.state.health.selectedId()).toBeNull();
    expect(page.state.health.definitionPath).toBe('');
    expect(page.state.health.automaticPath).toBe('');
    expect(page.state.health.pending()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-backup-health')).toBeNull();
  });
  it('cancels a Health confirmation synchronously on tab leave and rejects its late action', async () => {
    const { page, component, health } = await healthView();
    health.automaticPath = ' /private/automatic ';
    component.prepare('run');
    const context = dialogs.config!.context;
    component.ionViewWillLeave();
    expect(dialogs.element).toBeNull();
    expect(health.pending()).toBeNull();
    expect(health.selectedId()).toBeNull();
    expect(health.detail()).toBeNull();
    expect(health.automaticPath).toBe(' /private/automatic ');
    expect(page.state.active()).toBe(true);
    TestBed.inject(ArcaActionsService).dispatchAction('HEALTH_DIALOG_CLOSE', {
      option: 'confirm',
      data: { context },
    });
    component.confirm();
    http.expectNone(`${base}/health/run`);
  });
  it('invalidates a pending Health detail on tab leave without leaving loading stuck', () => {
    const page = enter().componentInstance;
    const health = page.state.health;
    health.select(run.run_id);
    const old = http.expectOne(getUrl());
    page.state.leaveTab();
    expect(health.detailLoading()).toBe(false);
    old.flush(run);
    expect(health.detail()).toBeNull();
    expect(health.selectedId()).toBeNull();
    expect(health.disabled()).toBe(false);
    health.select(run.run_id);
    http.expectOne(getUrl()).flush(run);
    expect(health.detail()).toEqual(run);
  });
  it.each(operations)(
    'retains sent Health %s results after changing tabs without reopening details',
    async (action) => {
      const { page, component, health } = await healthView();
      health.automaticPath = ' /automatic ';
      component.prepare(action);
      component.confirm();
      const request = http.expectOne(`${base}/health/${action}`);
      component.ionViewWillLeave();
      expect(health.writing()).toBe(true);
      expect(page.state.configurations.operationsBlocked()).toBe(true);
      request.flush(operationResponse(action));
      http.expectOne(`${base}/health`).flush([record]);
      http.expectNone(getUrl());
      expect(health.result()).toEqual(operationResponse(action));
      expect(health.selectedId()).toBeNull();
      expect(health.detail()).toBeNull();
      expect(health.writing()).toBe(false);
    },
  );
  it('retains a sent Health creation after tab leave without selecting its response', () => {
    const page = enter().componentInstance;
    const health = page.state.health;
    health.definitionPath = '/definition';
    health.create();
    const request = http.expectOne(`${base}/health/create`);
    page.state.leaveTab();
    request.flush(run);
    http.expectOne(`${base}/health`).flush([record]);
    http.expectNone(getUrl());
    expect(health.result()).toEqual(run);
    expect(health.cleanupResult()).toEqual(run);
    expect(health.selectedId()).toBeNull();
    expect(health.detail()).toBeNull();
  });

  it('rejects a late health detail after closing and reopening the same selection', () => {
    const page = enter().componentInstance;
    const state = page.state.health;
    state.select(run.run_id);
    const old = http.expectOne(getUrl());
    page.state.leaveTab();
    state.select(run.run_id);
    http.expectNone(getUrl());
    old.flush(run);
    const fresh = http.expectOne(getUrl());
    expect(state.detail()).toBeNull();
    expect(state.detailLoading()).toBe(true);
    fresh.flush(run);
    expect(state.detail()).toEqual(run);
    expect(state.detailLoading()).toBe(false);
  });
  it('invalidates focus restoration queued before the tab leaves', async () => {
    const { fixture, component } = await healthView();
    component.prepare('start');
    component.cancel();
    afterNextRender(
      {
        earlyRead: () => {
          component.ionViewWillLeave();
          document.body.tabIndex = -1;
          document.body.focus();
        },
      },
      { injector: fixture.debugElement.injector },
    );
    TestBed.tick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(document.body);
    document.body.removeAttribute('tabindex');
  });
  it('renders the exact history in a labelled table with local dates and neutral future values', async () => {
    const fixture = enter();
    fixture.detectChanges();
    await fixture.whenStable();
    const table = fixture.nativeElement.querySelector('table') as HTMLTableElement;
    const row = table.querySelector('tbody tr')!;
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(6);
    expect(row.querySelector('th[scope="row"]')?.textContent).toContain(run.run_id);
    for (const value of [
      'daily',
      'latest',
      'FUTURE_MODE',
      'FUTURE_STATE',
      'FUTURE_RESULT',
      'Completo: No',
    ])
      expect(row.textContent).toContain(value);
    expect(row.textContent).toContain(new Date(run.created_at).toLocaleString('es-ES'));
    expect(row.querySelector('.success, .danger, .warning')).toBeNull();
    expect(table.closest('[role="region"]')?.getAttribute('tabindex')).toBe('0');
    expect(fixture.nativeElement.textContent).toContain('hora local del navegador');
    expect(fixture.nativeElement.querySelector('app-backup-health-detail')).toBeNull();
    (row.querySelector('button') as HTMLButtonElement).click();
    http.expectOne(getUrl()).flush(run);
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    expect(panel.open()).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[panel-actions] button')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('#health-definition')).toBeNull();
    expect(fixture.nativeElement.querySelector('#health-automatic-definition')).toBeNull();
    expect(
      [...fixture.nativeElement.querySelectorAll('button')].some(
        (button: any) => button.textContent.trim() === 'Crear Health',
      ),
    ).toBe(true);
  });

  it('suspends the panel trap during confirmation and restores it with focus on cancellation', async () => {
    const { component, fixture, health } = await healthView();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    const trigger = fixture.nativeElement.querySelector(
      '[panel-actions] button',
    ) as HTMLButtonElement;
    trigger.focus();
    component.prepare('start');
    fixture.detectChanges();
    expect(panel.focusTrap()).toBe(false);
    expect(health.pending()?.value).toBe(run.run_id);
    component.cancel();
    TestBed.tick();
    await fixture.whenStable();
    expect(panel.focusTrap()).toBe(true);
    expect(document.activeElement).toBe(trigger);
    http.expectNone(`${base}/health/start`);
  });

  it('closes the inspector and invalidates its correlated confirmation without losing drafts', async () => {
    const { component, fixture, page, health } = await healthView();
    health.definitionPath = '/draft';
    component.prepare('delete');
    const context = dialogs.config!.context;
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    panel.closed.emit();
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    expect(dialogs.element).toBeNull();
    expect(health.pending()).toBeNull();
    expect(health.detail()).toBeNull();
    expect(health.selectedId()).toBeNull();
    expect(health.definitionPath).toBe('/draft');
    expect(health.entries()).toEqual([record]);
    expect(page.state.active()).toBe(true);
    TestBed.inject(ArcaActionsService).dispatchAction('HEALTH_DIALOG_CLOSE', {
      option: 'confirm',
      data: { context },
    });
    component.confirm();
    http.expectNone(`${base}/health/delete`);
  });

  it('closes a reading inspector, opens another and rejects the previous detail', async () => {
    const fixture = enter([record, { ...record, run_id: 'second' }]);
    const facade = fixture.componentInstance.state;
    facade.openHealthDetail(run.run_id);
    const old = http.expectOne(getUrl());
    facade.closeHealthDetail();
    expect(facade.health.detailLoading()).toBe(false);
    facade.openHealthDetail('second');
    http.expectNone(getUrl('second'));
    old.flush(run);
    const fresh = http.expectOne(getUrl('second'));
    expect(facade.health.detail()).toBeNull();
    expect(facade.health.detailLoading()).toBe(true);
    fresh.flush({ ...run, run_id: 'second' });
    fixture.detectChanges();
    expect(facade.health.detail()?.run_id).toBe('second');
    expect(facade.panel()).toBe('health-detail');
    expect(facade.health.detailLoading()).toBe(false);
    facade.closeHealthDetail();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-backup-health-detail')).toBeNull();
  });

  it('closes a vanished selection and exposes the list heading as panel focus fallback', async () => {
    const { fixture, health, page, component } = await healthView();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    expect(panel.fallbackFocus()).toBe(component.listHeading()?.nativeElement);
    expect(panel.fallbackFocus()?.tabIndex).toBe(-1);
    health.refresh();
    http.expectOne(`${base}/health`).flush([]);
    TestBed.tick();
    await fixture.whenStable();
    expect(panel.open()).toBe(false);
    expect(page.state.panel()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No hay ejecuciones de Health');
  });

  it.each(operations)(
    'keeps a sent %s result outside a closed inspector without reopening it',
    async (action) => {
      const { component, fixture, page, health } = await healthView();
      component.prepare(action);
      component.confirm();
      const request = http.expectOne(`${base}/health/${action}`);
      page.state.closeHealthDetail();
      expect(health.writing()).toBe(true);
      request.flush(operationResponse(action));
      http.expectOne(`${base}/health`).flush([record]);
      http.expectNone(getUrl());
      fixture.detectChanges();
      expect(page.state.panel()).toBeNull();
      expect(health.selectedId()).toBeNull();
      expect(health.result()).toEqual(operationResponse(action));
      expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(run.run_id);
      expect(fixture.nativeElement.querySelector('app-backup-health-detail')).toBeNull();
    },
  );
  it('keeps unrecognized dates and nulls without breaking history or detail', async () => {
    expect(healthDate(null)).toBe('null');
    expect(healthDate('')).toBe('');
    expect(healthDate('unknown-date')).toBe('unknown-date');
    const fixture = enter([{ ...record, created_at: 'future-calendar' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tbody')?.textContent).toContain('future-calendar');
    fixture.componentInstance.state.openHealthDetail(run.run_id);
    http.expectOne(getUrl()).flush({
      ...run,
      created_at: 'future-calendar',
      started_at: null,
      finished_at: 'unknown-end',
      diagnosis: {
        ...run.diagnosis,
        evidence: [{ ...run.diagnosis.evidence[0], observed_at: 'unknown-evidence' }],
      },
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('app-backup-health-detail')?.textContent;
    for (const value of ['future-calendar', 'null', 'unknown-end', 'unknown-evidence'])
      expect(text).toContain(value);
  });

  it('keeps a confirmed creation result outside the panel when history refresh fails', async () => {
    const { fixture, component, page, panel } = await formView('health-create');
    component.create();
    http.expectOne(`${base}/health/create`).flush(run);
    expect(page.state.panel()).toBeNull();
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    expect(component.state.result()).toEqual(run);
    expect(component.state.listError()).not.toBe('');
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(run.run_id);
    expect(fixture.nativeElement.querySelector('.success details pre')?.textContent).toContain(
      'kept-volume',
    );
    expect(fixture.nativeElement.querySelector('app-backup-health-detail')).toBeNull();
    component.state.refresh();
    http.expectOne(`${base}/health`).flush([record]);
    page.state.openHealthDetail(run.run_id);
    http.expectOne(getUrl()).flush(run);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '[panel-actions] button',
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    trigger.click();
    expect(component.state.pending()?.value).toBe(run.run_id);
    component.cancel();
    http.expectNone(`${base}/health/start`);
  });

  it('does not reopen the inspector for a creation confirmed after tab leave', () => {
    const fixture = enter();
    fixture.detectChanges();
    const component = fixture.debugElement.query(By.directive(BackupHealth))
      .componentInstance as BackupHealth;
    component.create();
    const request = http.expectOne(`${base}/health/create`);
    component.ionViewWillLeave();
    request.flush(run);
    http.expectOne(`${base}/health`).flush([record]);
    http.expectNone(getUrl());
    expect(fixture.componentInstance.state.panel()).toBeNull();
    expect(component.state.result()).toEqual(run);
    expect(component.state.selectedId()).toBeNull();
  });
  it('keeps independent form drafts across close and tabs, then clears them on module exit', async () => {
    const { fixture, page, component, panel, health } = await formView('health-create');
    const definition = fixture.nativeElement.querySelector(
      '#health-definition',
    ) as HTMLInputElement;
    definition.value = ' /srv/definición #1.toml ';
    definition.dispatchEvent(new Event('input', { bubbles: true }));
    const mode = fixture.nativeElement.querySelector('#health-mode') as HTMLSelectElement;
    mode.value = 'AUTOMATIC';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    panel.closed.emit();
    page.state.openHealthForm('health-run');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#health-definition')).toBeNull();
    const automatic = fixture.nativeElement.querySelector(
      '#health-automatic-definition',
    ) as HTMLInputElement;
    automatic.value = ' /srv/otra definición.toml ';
    automatic.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    component.ionViewWillLeave();
    component.ionViewWillEnter();
    page.state.openHealthForm('health-create');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#health-definition').value).toBe(definition.value);
    expect(fixture.nativeElement.querySelector('#health-mode').value).toBe('AUTOMATIC');
    expect(health.automaticPath).toBe(automatic.value);
    expect(fixture.nativeElement.querySelector('#health-automatic-definition')).toBeNull();
    panel.closed.emit();
    page.state.openHealthForm('health-run');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#health-automatic-definition').value).toBe(
      automatic.value,
    );
    http.expectNone((request) => request.url.startsWith(base));
    page.state.ionViewWillLeave();
    expect(health.definitionPath).toBe('');
    expect(health.mode).toBe('MANUAL');
    expect(health.automaticPath).toBe('');
    expect(page.state.panel()).toBeNull();
  });

  it.each(['MANUAL', 'AUTOMATIC'] as const)(
    'submits creation in %s once without executing, and closes only on its result',
    async (mode) => {
      const { fixture, page, health, panel } = await formView('health-create');
      health.definitionPath = ' /srv/definición #ñ.toml ';
      health.mode = mode;
      health.automaticPath = '/independent-automatic';
      fixture.detectChanges();
      const submit = fixture.nativeElement.querySelector(
        'button[form="health-create-form"]',
      ) as HTMLButtonElement;
      expect(submit.form?.id).toBe('health-create-form');
      expect(fixture.nativeElement.querySelectorAll('button[type="submit"]')).toHaveLength(1);
      submit.click();
      const form = fixture.nativeElement.querySelector('#health-create-form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const request = http.expectOne(`${base}/health/create`);
      expect(request.request.body).toEqual({ definition_path: health.definitionPath, mode });
      expect(dialogs.element).toBeNull();
      expect(panel.open()).toBe(true);
      expect(page.state.configurations.operationsBlocked()).toBe(true);
      http.expectNone(`${base}/health/start`);
      http.expectNone(`${base}/health/run`);
      request.flush(run);
      fixture.detectChanges();
      expect(page.state.panel()).toBeNull();
      expect(panel.open()).toBe(false);
      expect(health.definitionPath).toBe('');
      expect(health.mode).toBe('MANUAL');
      expect(health.automaticPath).toBe('/independent-automatic');
      expect(health.result()).toEqual(run);
      expect(health.resultLabel()).toContain('Crear no inicia');
      expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(run.run_id);
      expect(health.selectedId()).toBeNull();
      http.expectOne(`${base}/health`).flush([record]);
      http.expectNone(getUrl());
    },
  );

  it('confirms automatic submission with its frozen exact route, cancels and then admits it once', async () => {
    const { fixture, page, component, panel, health } = await formView('health-run');
    health.automaticPath = ' ./ruta/../automático #ñ.toml ';
    health.definitionPath = '/independent-create';
    health.mode = 'AUTOMATIC';
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector(
      'button[form="health-run-form"]',
    ) as HTMLButtonElement;
    expect(submit.form?.id).toBe('health-run-form');
    submit.focus();
    submit.click();
    fixture.detectChanges();
    const frozen = health.pending()!;
    expect(frozen.value).toBe(' ./ruta/../automático #ñ.toml ');
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(String(dialogs.config?.text)).toContain('La admisión no confirma');
    expect(panel.focusTrap()).toBe(false);
    http.expectNone(`${base}/health/run`);
    dialogs.choose('cancel');
    TestBed.tick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(submit);
    expect(panel.open()).toBe(true);
    expect(panel.focusTrap()).toBe(true);
    expect(health.automaticPath).toBe(frozen.value);
    submit.click();
    health.automaticPath = '/changed-after-confirmation';
    dialogs.choose('confirm');
    component.confirm();
    const request = http.expectOne(`${base}/health/run`);
    expect(request.request.body).toEqual({ definition_path: frozen.value });
    request.flush(admitted);
    fixture.detectChanges();
    expect(page.state.panel()).toBeNull();
    expect(panel.open()).toBe(false);
    expect(health.automaticPath).toBe('');
    expect(health.definitionPath).toBe('/independent-create');
    expect(health.mode).toBe('AUTOMATIC');
    expect(health.queuedResult()).toEqual(admitted);
    expect(health.resultLabel()).toContain('solicitud admitida');
    const result = fixture.nativeElement.querySelector('.success')?.textContent;
    expect(result).toContain(run.run_id);
    expect(result).toContain('queue-id');
    expect(result).toContain('run_id identifica Health');
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(health.result()).toEqual(admitted);
    expect(health.listError()).not.toBe('');
    http.expectNone(getUrl());
  });

  it.each([
    { mode: 'health-create', operation: 'create', status: 502 },
    { mode: 'health-create', operation: 'create', status: 504 },
    { mode: 'health-create', operation: 'create', status: 0 },
    { mode: 'health-run', operation: 'run', status: 502 },
    { mode: 'health-run', operation: 'run', status: 504 },
    { mode: 'health-run', operation: 'run', status: 0 },
  ] as const)(
    'preserves $mode draft and panel after failure $status without retrying',
    async ({ mode, operation, status }) => {
      const { fixture, page, component, panel, health } = await formView(mode);
      health.definitionPath = ' /create ';
      health.mode = 'AUTOMATIC';
      health.automaticPath = ' /run ';
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      if (operation === 'run') dialogs.choose('confirm');
      const request = http.expectOne(`${base}/health/${operation}`);
      if (status === 0) request.error(new ProgressEvent('error'));
      else
        request.flush(
          { detail: { code: status === 502 ? 'core_error' : 'core_timeout' } },
          { status, statusText: 'Failed' },
        );
      fixture.detectChanges();
      await fixture.whenStable();
      expect(page.state.panel()).toBe(mode);
      expect(panel.open()).toBe(true);
      expect(health.definitionPath).toBe(' /create ');
      expect(health.mode).toBe('AUTOMATIC');
      expect(health.automaticPath).toBe(' /run ');
      expect(health.result()).toBeNull();
      const message = status === 502 ? health.error() : health.uncertainties()[0];
      expect(message).toBeTruthy();
      expect(
        fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
      ).toContain(message);
      page.state.closeHealthPanel();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-side-panel [role="alert"]')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain(message);
      component.ionViewWillLeave();
      component.ionViewWillEnter();
      page.state.openHealthForm(mode);
      fixture.detectChanges();
      await fixture.whenStable();
      const input = fixture.nativeElement.querySelector('app-side-panel input') as HTMLInputElement;
      expect(input.value).toBe(operation === 'create' ? ' /create ' : ' /run ');
      http.expectNone(`${base}/health/${operation}`);
      http.expectNone(`${base}/health`);
    },
  );

  it.each(['health-create', 'health-run'] as const)(
    'keeps %s open when the request completes without a result',
    async (mode) => {
      const { fixture, page, panel, health } = await formView(mode);
      health.definitionPath = '/create';
      health.automaticPath = '/automatic';
      health.mode = 'AUTOMATIC';
      const service = TestBed.inject(BackupsService);
      const operation = mode === 'health-create' ? 'healthCreate' : 'healthRun';
      vi.spyOn(service, operation).mockReturnValue(EMPTY);
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      if (mode === 'health-run') dialogs.choose('confirm');
      fixture.detectChanges();
      expect(page.state.panel()).toBe(mode);
      expect(panel.open()).toBe(true);
      expect(health.definitionPath).toBe('/create');
      expect(health.mode).toBe('AUTOMATIC');
      expect(health.automaticPath).toBe('/automatic');
      expect(health.result()).toBeNull();
      expect(health.writing()).toBe(false);
      http.expectNone((request) => request.url.startsWith(base));
    },
  );

  it.each(['health-create', 'health-run'] as const)(
    'does not close another panel or select a run for a late %s response',
    async (mode) => {
      const { fixture, page, panel, health } = await formView(mode);
      health.definitionPath = '/create';
      health.automaticPath = '/automatic';
      const operation = mode === 'health-create' ? 'create' : 'run';
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      if (mode === 'health-run') dialogs.choose('confirm');
      const request = http.expectOne(`${base}/health/${operation}`);
      panel.closed.emit();
      expect(health.writing()).toBe(true);
      expect(health.selectedId()).toBeNull();
      // Simulate another view owning the panel while the previous view's write finishes.
      page.state.reports.selectedId.set('another-report');
      page.state.panel.set('report-detail');
      request.flush(operation === 'create' ? run : admitted);
      http.expectOne(`${base}/health`).flush([record]);
      http.expectNone(getUrl());
      fixture.detectChanges();
      expect(page.state.panel()).toBe('report-detail');
      expect(page.state.reports.selectedId()).toBe('another-report');
      expect(health.selectedId()).toBeNull();
      expect(health.detail()).toBeNull();
      expect(health.result()).toEqual(operation === 'create' ? run : admitted);
      expect(health.writing()).toBe(false);
    },
  );

  it('cancels the automatic confirmation when its panel closes and ignores the late dialog result', async () => {
    const { fixture, page, component, panel, health } = await formView('health-run');
    health.automaticPath = ' /automatic ';
    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const context = dialogs.config!.context;
    panel.closed.emit();
    fixture.detectChanges();
    expect(page.state.panel()).toBeNull();
    expect(dialogs.element).toBeNull();
    expect(health.pending()).toBeNull();
    expect(health.automaticPath).toBe(' /automatic ');
    TestBed.inject(ArcaActionsService).dispatchAction('HEALTH_DIALOG_CLOSE', {
      option: 'confirm',
      data: { context },
    });
    component.confirm();
    http.expectNone(`${base}/health/run`);
  });

  it.each(['health-create', 'health-run'] as const)(
    'keeps invalid Unicode in %s without dispatching or losing its draft',
    async (mode) => {
      const { fixture, panel, health } = await formView(mode);
      health.definitionPath = '\ud800';
      health.automaticPath = '\ud800';
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(panel.open()).toBe(true);
      expect(health.error()).toContain('Unicode');
      expect(health.definitionPath).toBe('\ud800');
      expect(health.automaticPath).toBe('\ud800');
      expect(dialogs.element).toBeNull();
      expect(
        fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
      ).toContain('Unicode');
      http.expectNone((request) => request.url.startsWith(base));
    },
  );
});
