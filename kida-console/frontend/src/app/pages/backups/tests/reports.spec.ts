import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterNextRender, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { BackupsService } from '../services/backups.service';
import { Backups } from '../backups';
import { BackupReports } from '../tabs/backup-reports/reports';
import { HealthReport } from '../utils/reports.models';

let dialogs: ReturnType<typeof mockArcaDialogs>;
const base = `${environment.apiBaseUrl}/backup`;
const listUrl = `${base}/health/reports`;
const deleteUrl = `${listUrl}/delete`;
const id = ' report /?&+#ñ\n  exact ';
const report: HealthReport = {
  run_id: id,
  markdown:
    '# Informe\n\n  dos espacios\n<script>window.injected=true</script>\n<img src=x onerror="alert(1)">\n[enlace](javascript:alert(1))',
  future: null,
};
const deleted = { run_id: id, deleted: true, future: null };
const getUrl = (value = id) => `${listUrl}/get?run_id=${encodeURIComponent(value)}`;
function setup() {
  TestBed.configureTestingModule({
    imports: [Backups, BackupReports],
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
      imports: [BackupReports],
      template: '@if (state.active()) { <app-backup-reports /> }',
    },
  });
  TestBed.overrideComponent(SidePanel, {
    set: { template: '@if (open()) { <ng-content /><ng-content select="[panel-actions]" /> }' },
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  dialogs = mockArcaDialogs();
  return TestBed.inject(HttpTestingController);
}

describe('Health report contracts through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });

  it('keeps list, detail and deletion on independent channels', () => {
    const service = TestBed.inject(BackupsService),
      next = vi.fn();
    service.reportList().subscribe(next);
    service.reportGet(id).subscribe(next);
    service.reportDelete(id).subscribe(next);
    http.expectOne(listUrl).flush([id]);
    http.expectOne(getUrl()).flush(report);
    http.expectOne(deleteUrl).flush(deleted);
    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe('Health report state, confirmation and page integration', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });
  function entry(rows = [id, 'second']) {
    const fixture = TestBed.createComponent(Backups);
    fixture.detectChanges();
    fixture.componentInstance.ionViewWillEnter();
    initial(rows);
    return fixture;
  }
  function initial(rows = [id, 'second']) {
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush(rows);
  }
  function select(page: Backups) {
    page.state.openReportDetail(id);
    http.expectOne(getUrl()).flush(report);
  }
  function refreshed(rows = [id, 'second']) {
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush(rows);
    if (rows.includes(id)) http.expectOne(getUrl()).flush(report);
  }
  async function reportView() {
    const fixture = entry();
    const page = fixture.componentInstance;
    select(page);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return {
      page,
      reports: page.state.reports,
      fixture,
      component: fixture.debugElement.query(
        (element) => element.componentInstance instanceof BackupReports,
      ).componentInstance as BackupReports,
    };
  }
  it('uses the shared ARCA dialog for the exact report identifier', async () => {
    const { component, reports } = await reportView();
    component.prepare(id);
    expect(dialogs.config?.title).toBe('Confirmar eliminación de informe');
    expect(dialogs.element?.textContent).toContain(id);
    dialogs.choose('cancel');
    expect(reports.pending()).toBeNull();
    http.expectNone(deleteUrl);
  });
  it('loads on entry without polling and distinguishes initial failure, retry and empty', () => {
    const fixture = TestBed.createComponent(Backups),
      page = fixture.componentInstance;
    fixture.detectChanges();
    page.ionViewWillEnter();
    page.state.reports.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(page.state.reports.entries()).toBeNull();
    expect(page.state.reports.updated()).toBeNull();
    expect(page.state.reports.listError()).not.toBe('');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Error de actualización de informes');
    expect(fixture.nativeElement.textContent).not.toContain('No hay informes de Health');
    page.state.reports.refresh();
    http.expectOne(listUrl).flush([]);
    expect(page.state.reports.entries()).toEqual([]);
    expect(page.state.reports.listError()).toBe('');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay informes de Health');
    expect(fixture.nativeElement.querySelector('.report-list')).toBeNull();
    page.state.reports.refresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cargando informes');
    expect(fixture.nativeElement.textContent).not.toContain('No hay informes de Health');
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Error de actualización de informes');
    expect(fixture.nativeElement.textContent).not.toContain('No hay informes de Health');
    http.expectNone(listUrl);
  });
  it('retains stale reads on errors and clears selection only after successful disappearance', () => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    select(page);
    reports.refresh();
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(reports.entries()).toEqual([id, 'second']);
    expect(reports.detail()).toEqual(report);
    reports.refresh();
    http.expectOne(listUrl).flush([id]);
    http.expectOne(getUrl()).flush({}, { status: 502, statusText: 'Failed' });
    expect(reports.detail()).toEqual(report);
    expect(reports.detailError()).not.toBe('');
    reports.refresh();
    http.expectOne(listUrl).flush([]);
    expect(reports.selectedId()).toBeNull();
    expect(reports.detail()).toBeNull();
  });
  it('clears old detail on another selection and blocks overlapping detail reads', () => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    select(page);
    reports.select('second');
    reports.select(id);
    expect(reports.selectedId()).toBe('second');
    expect(reports.detail()).toBeNull();
    http.expectOne(getUrl('second')).flush({ run_id: 'second', markdown: '' });
    http.expectNone(getUrl());
    expect(reports.detail()?.markdown).toBe('');
  });
  it('renders remote Markdown and IDs as literal safe text with exact whitespace', async () => {
    const { fixture } = await reportView();
    const markdown = fixture.nativeElement.querySelector('[data-testid="report-markdown"]');
    expect(markdown.textContent).toBe(report.markdown);
    expect(fixture.nativeElement.querySelector('img,script,a')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(id);
  });
  it('freezes the destination, locks all panels, cancels and confirms once', async () => {
    const { page, reports, fixture, component } = await reportView();
    component.prepare(id);
    fixture.detectChanges();
    expect(Object.isFrozen(reports.pending())).toBe(true);
    expect(reports.pending()?.run_id).toBe(id);
    expect(page.state.operationsBlocked()).toBe(true);
    expect(page.state.health.disabled()).toBe(true);
    page.state.configurations.refresh();
    page.state.configurations.create();
    page.state.health.create();
    page.state.health.refresh();
    reports.refresh();
    reports.select('second');
    http.expectNone(`${base}/config`);
    http.expectNone(`${base}/config/create`);
    http.expectNone(`${base}/health/create`);
    http.expectNone(`${base}/health`);
    http.expectNone(listUrl);
    expect(dialogs.element).not.toBeNull();
    dialogs.dismiss();
    expect(reports.pending()).toBeNull();
    expect(dialogs.element).toBeNull();
    http.expectNone(deleteUrl);
    component.prepare(id);
    reports.selectedId.set('second');
    reports.detail.set({ run_id: 'second', markdown: 'changed' });
    fixture.detectChanges();
    expect(dialogs.element!.textContent).toContain(id);
    component.confirm();
    component.confirm();
    reports.confirm();
    const request = http.expectOne(deleteUrl);
    expect(request.request.body).toEqual({ run_id: id });
    expect(dialogs.element).toBeNull();
    request.flush(deleted);
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush(['second']);
    http.expectOne(getUrl('second')).flush({ run_id: 'second', markdown: 'changed' });
    expect(reports.result()).toEqual(deleted);
    expect(reports.occupied()).toBe(false);
  });
  it('fails closed when the dialog cannot open', async () => {
    const { reports, component } = await reportView();
    dialogs.open.mockImplementationOnce(() => {
      throw new Error();
    });
    component.prepare(id);
    component.confirm();
    expect(reports.pending()).toBeNull();
    expect(reports.disabled()).toBe(false);
    expect(reports.error()).toContain('abrir la confirmación');
    http.expectNone(deleteUrl);
  });
  it.each([true, false])(
    'shows deleted:%s literally and refreshes without optimistic changes',
    (wasDeleted) => {
      const page = entry().componentInstance,
        reports = page.state.reports;
      select(page);
      reports.prepare(id);
      reports.confirm();
      const request = http.expectOne(deleteUrl);
      expect(reports.entries()).toEqual([id, 'second']);
      expect(reports.detail()).toEqual(report);
      request.flush({ ...deleted, deleted: wasDeleted });
      expect(reports.result()?.deleted).toBe(wasDeleted);
      refreshed(wasDeleted ? ['second'] : [id, 'second']);
      expect(reports.selectedId()).toBe(wasDeleted ? null : id);
      expect(reports.detail()).toEqual(wasDeleted ? null : report);
      expect(reports.resultLabel()).toContain(wasDeleted ? 'Informe eliminado' : 'no confirmó');
    },
  );
  it('keeps deletion success independent from failed report and Health refreshes', () => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    select(page);
    reports.prepare(id);
    reports.confirm();
    http.expectOne(deleteUrl).flush(deleted);
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(reports.result()).toEqual(deleted);
    expect(reports.listError()).not.toBe('');
    expect(page.state.health.listError()).not.toBe('');
    expect(reports.detail()).toEqual(report);
  });
  it('refreshes selected Health report status and path after report deletion', () => {
    const page = entry().componentInstance;
    page.state.health.refresh();
    http.expectOne(`${base}/health`).flush([{ run_id: 'health-id', report_status: 'READY' }]);
    page.state.health.select('health-id');
    http
      .expectOne(`${base}/health/get?run_id=health-id`)
      .flush({ run_id: 'health-id', report_path: '/old/report.md' });
    page.state.reports.prepare(id);
    page.state.reports.confirm();
    http.expectOne(deleteUrl).flush(deleted);
    expect(page.state.health.occupied()).toBe(true);
    http.expectOne(`${base}/health`).flush([{ run_id: 'health-id', report_status: 'MISSING' }]);
    http
      .expectOne(`${base}/health/get?run_id=health-id`)
      .flush({ run_id: 'health-id', report_path: null });
    http.expectOne(listUrl).flush([]);
    expect(page.state.health.selectedHistory()?.report_status).toBe('MISSING');
    expect(page.state.health.detail()?.report_path).toBeNull();
    expect(page.state.reports.result()).toEqual(deleted);
    expect(page.state.operationsBlocked()).toBe(false);
  });
  it.each([
    [422, undefined, 'Validación'],
    [502, 'core_error', 'CORE rechazó'],
    [503, 'core_unavailable', 'Sin conexión'],
    [504, 'core_timeout', 'No se pudo confirmar'],
    [0, undefined, 'No se pudo confirmar'],
  ] as const)(
    'handles rejection or uncertainty %s without retrying or clearing the target',
    (status, code, text) => {
      const page = entry().componentInstance,
        reports = page.state.reports;
      select(page);
      reports.prepare(id);
      reports.confirm();
      const request = http.expectOne(deleteUrl);
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush({ detail: { code } }, { status, statusText: 'Failed' });
      expect(reports.result()).toBeNull();
      expect(reports.writing()).toBe(false);
      expect(reports.detail()).toEqual(report);
      expect(reports.error() + reports.uncertainties().join()).toContain(text);
      http.expectNone(deleteUrl);
      http.expectNone(listUrl);
      http.expectNone(`${base}/health`);
    },
  );
  it('retains uncertain action and exact destination through refresh and a later successful deletion', () => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    select(page);
    reports.prepare(id);
    reports.confirm();
    http.expectOne(deleteUrl).flush({}, { status: 504, statusText: 'Timeout' });
    const warning = reports.uncertainties()[0];
    expect(warning).toContain(id);
    expect(warning).toContain('Eliminar informe');
    reports.refresh();
    http.expectOne(listUrl).flush([id]);
    http.expectOne(getUrl()).flush(report);
    reports.prepare(id);
    reports.confirm();
    http.expectOne(deleteUrl).flush(deleted);
    refreshed([]);
    expect(reports.uncertainties()).toEqual([warning]);
    expect(reports.detail()).toBeNull();
    expect(reports.result()).toEqual(deleted);
  });
  it('blocks Reports while configuration confirmation, write or refresh is active', () => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    page.state.configurations.prepare('run', { id: 'b', name: 'name' } as never);
    reports.refresh();
    reports.select(id);
    reports.prepare(id);
    expect(reports.disabled()).toBe(true);
    expect(reports.pending()).toBeNull();
    http.expectNone(listUrl);
    http.expectNone(getUrl());
    page.state.configurations.confirm();
    reports.refresh();
    http.expectOne(`${base}/run`).flush({ state: 'QUEUED', execution_id: 'e' });
    reports.refresh();
    http.expectNone(listUrl);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(reports.disabled()).toBe(false);
  });
  it('blocks Reports while Health reads or writes, and blocks Health/config during report reads', () => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    page.state.health.refresh();
    reports.refresh();
    reports.prepare(id);
    expect(reports.pending()).toBeNull();
    http.expectNone(listUrl);
    http.expectOne(`${base}/health`).flush([]);
    page.state.health.create();
    reports.refresh();
    http.expectNone(listUrl);
    http.expectOne(`${base}/health/create`).flush({}, { status: 422, statusText: 'Invalid' });
    reports.select(id);
    page.state.configurations.refresh();
    page.state.health.refresh();
    page.state.health.create();
    http.expectNone(`${base}/config`);
    http.expectNone(`${base}/health`);
    http.expectNone(`${base}/health/create`);
    http.expectOne(getUrl()).flush(report);
    expect(page.state.operationsBlocked()).toBe(false);
  });
  it.each(['list'])('ignores late %s on leave and isolates a fresh session', (operation) => {
    const page = entry().componentInstance,
      reports = page.state.reports;
    const send = () =>
      operation === 'list'
        ? reports.refresh()
        : operation === 'get'
          ? reports.select(id)
          : (reports.prepare(id), reports.confirm());
    const url = operation === 'list' ? listUrl : operation === 'get' ? getUrl() : deleteUrl;
    send();
    const old = http.expectOne(url);
    page.ionViewWillLeave();
    expect(reports.entries()).toBeNull();
    expect(reports.pending()).toBeNull();
    TestBed.inject(ThemeIdentity).begin();
    page.ionViewWillEnter();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    http.expectNone(url);
    old.flush(operation === 'list' ? [id] : operation === 'get' ? report : deleted);
    const fresh = http.expectOne(url);
    expect(reports.entries()).toBeNull();
    expect(reports.result()).toBeNull();
    expect(reports.detail()).toBeNull();
    fresh.flush(operation === 'list' ? [id] : operation === 'get' ? report : deleted);
    if (operation === 'delete') refreshed([]);
    expect(
      operation === 'list'
        ? reports.entries()
        : operation === 'get'
          ? reports.detail()
          : reports.result(),
    ).toEqual(operation === 'list' ? [id] : operation === 'get' ? report : deleted);
  });

  it('rejects malformed Unicode before opening or dispatching', async () => {
    const { reports, component } = await reportView();
    component.prepare('\ud800');
    component.confirm();
    expect(reports.error()).toContain('Unicode');
    expect(reports.pending()).toBeNull();
    expect(dialogs.element !== null).toBe(false);
    http.expectNone(deleteUrl);
  });
  it.each(['leave', 'session'] as const)(
    'clears pending confirmation on %s and cannot send later',
    async (reason) => {
      const { page, reports, fixture, component } = await reportView();
      component.prepare(id);
      fixture.detectChanges();
      expect(dialogs.element !== null).toBe(true);
      if (reason === 'leave') page.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      fixture.detectChanges();
      expect(dialogs.element !== null).toBe(false);
      expect(reports.pending()).toBeNull();
      expect(reports.detail()).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain(report.markdown);
      component.confirm();
      http.expectNone(deleteUrl);
    },
  );
  it.each([200, 502, 504])(
    'focuses Cancel and restores operation focus after %s',
    async (status) => {
      const { reports, fixture, component } = await reportView();
      const trigger = fixture.nativeElement.querySelector(
        '[panel-actions] button.danger',
      ) as HTMLButtonElement;
      trigger.focus();
      component.prepare(id);
      fixture.detectChanges();
      TestBed.tick();
      expect(document.activeElement).toBe(
        dialogs.element!.querySelector('[data-dialog-option="cancel"]'),
      );
      component.cancel();
      TestBed.tick();
      await fixture.whenStable();
      expect(document.activeElement).toBe(trigger);
      component.prepare(id);
      component.confirm();
      fixture.detectChanges();
      const request = http.expectOne(deleteUrl);
      if (status === 200) {
        request.flush({ ...deleted, deleted: false });
        refreshed();
      } else
        request.flush(
          { detail: { code: status === 502 ? 'core_error' : 'core_timeout' } },
          { status, statusText: 'Failed' },
        );
      TestBed.tick();
      await fixture.whenStable();
      expect(reports.disabled()).toBe(false);
      expect(document.activeElement).toBe(trigger);
    },
  );
  it('clears report data and cached DOM when a detached page changes session', async () => {
    const fixture = entry(),
      page = fixture.componentInstance;
    select(page);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.debugElement.query(
      (element) => element.componentInstance instanceof BackupReports,
    ).componentInstance as BackupReports;
    component.prepare(id);
    fixture.detectChanges();
    expect(dialogs.element !== null).toBe(true);
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(page.state.reports.entries()).toBeNull();
    expect(page.state.reports.detail()).toBeNull();
    expect(page.state.reports.pending()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-backup-reports')).toBeNull();
  });
  it('cancels a report confirmation synchronously on tab leave and rejects its late action', async () => {
    const { page, component, reports } = await reportView();
    component.prepare(id);
    const context = dialogs.config!.context;
    component.ionViewWillLeave();
    expect(dialogs.element).toBeNull();
    expect(reports.pending()).toBeNull();
    expect(reports.detail()).toBeNull();
    expect(page.state.active()).toBe(true);
    TestBed.inject(ArcaActionsService).dispatchAction('REPORT_DIALOG_CLOSE', {
      option: 'confirm',
      data: { context },
    });
    component.confirm();
    http.expectNone(deleteUrl);
  });
  it('invalidates pending report detail without leaving loading stuck on tab leave', () => {
    const page = entry().componentInstance;
    const reports = page.state.reports;
    reports.select(id);
    const old = http.expectOne(getUrl());
    page.state.leaveTab();
    expect(reports.detailLoading()).toBe(false);
    old.flush(report);
    expect(reports.detail()).toBeNull();
    expect(reports.disabled()).toBe(false);
    reports.select(id);
    http.expectOne(getUrl()).flush(report);
    expect(reports.detail()).toEqual(report);
  });
  it('finishes a sent report deletion and refreshes Health across tabs without restoring selection', async () => {
    const { component, reports } = await reportView();
    component.prepare(id);
    component.confirm();
    const request = http.expectOne(deleteUrl);
    component.ionViewWillLeave();
    expect(reports.writing()).toBe(true);
    request.flush(deleted);
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush([id, 'second']);
    http.expectNone(getUrl());
    expect(reports.result()).toEqual(deleted);
    expect(reports.selectedId()).toBeNull();
    expect(reports.detail()).toBeNull();
  });

  it('rejects a late reports detail after closing and reopening the same selection', () => {
    const page = entry().componentInstance;
    const state = page.state.reports;
    state.select(id);
    const old = http.expectOne(getUrl());
    page.state.leaveTab();
    state.select(id);
    http.expectNone(getUrl());
    old.flush(report);
    const fresh = http.expectOne(getUrl());
    expect(state.detail()).toBeNull();
    expect(state.detailLoading()).toBe(true);
    fresh.flush(report);
    expect(state.detail()).toEqual(report);
    expect(state.detailLoading()).toBe(false);
  });
  it('invalidates focus restoration queued before the tab leaves', async () => {
    const { fixture, component } = await reportView();
    component.prepare(id);
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
  it.each([id, ''])(
    'opens the exact report ID %j in a reader with safe full text and JSON',
    async (value) => {
      const fixture = entry([value]);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('[data-testid="report-markdown"]')).toBeNull();
      const row = fixture.nativeElement.querySelector('.report-list li') as HTMLElement;
      expect(row.querySelector('.report-id')?.textContent).toBe(value);
      expect(row.querySelectorAll('button')).toHaveLength(2);
      const trigger = row.querySelector('button.secondary') as HTMLButtonElement;
      trigger.focus();
      trigger.click();
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.directive(SidePanel))
        .componentInstance as SidePanel;
      expect(panel.open()).toBe(true);
      expect(fixture.nativeElement.querySelector('app-side-panel')?.textContent).toContain(
        'Cargando informe',
      );
      const response = {
        ...report,
        run_id: value,
        markdown: '  inicio\n\n' + report.markdown + '\n  fin\n',
        future: { value: 9007199254740992 },
      };
      http.expectOne(getUrl(value)).flush(response);
      fixture.detectChanges();
      const reader = fixture.nativeElement.querySelector('app-side-panel') as HTMLElement;
      expect(reader.querySelector('[data-testid="report-markdown"]')?.textContent).toBe(
        response.markdown,
      );
      expect(reader.querySelector('details pre')?.textContent).toContain('9007199254740992');
      expect(reader.textContent).toContain('Precisión limitada');
      expect(fixture.nativeElement.querySelector('img,script,a')).toBeNull();
      const remove = reader.querySelector('[panel-actions] button.danger') as HTMLButtonElement;
      expect(remove.disabled).toBe(false);
      remove.click();
      expect(dialogs.config?.title).toBe('Confirmar eliminación de informe');
      expect(fixture.componentInstance.state.reports.pending()?.run_id).toBe(value);
      dialogs.choose('cancel');
      http.expectNone(deleteUrl);
    },
  );

  it.each([true, false])(
    'keeps deleted:%s truthful in the reader and returns valid focus if it disappears',
    async (wasDeleted) => {
      const fixture = entry();
      fixture.autoDetectChanges();
      await fixture.whenStable();
      const opener = fixture.nativeElement.querySelector(
        '.report-list button.secondary',
      ) as HTMLButtonElement;
      opener.focus();
      opener.click();
      http.expectOne(getUrl()).flush(report);
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.directive(SidePanel))
        .componentInstance as SidePanel;
      const component = fixture.debugElement.query(By.directive(BackupReports))
        .componentInstance as BackupReports;
      const remove = fixture.nativeElement.querySelector(
        '[panel-actions] button.danger',
      ) as HTMLButtonElement;
      remove.focus();
      remove.click();
      fixture.detectChanges();
      expect(panel.focusTrap()).toBe(false);
      expect(Object.isFrozen(component.state.pending())).toBe(true);
      expect(component.state.pending()?.run_id).toBe(id);
      expect(dialogs.element?.textContent).toContain('distinto de eliminar la ejecución');
      dialogs.choose('cancel');
      TestBed.tick();
      await fixture.whenStable();
      expect(panel.focusTrap()).toBe(true);
      expect(document.activeElement).toBe(remove);
      http.expectNone(deleteUrl);
      remove.click();
      dialogs.choose('confirm');
      component.confirm();
      const request = http.expectOne(deleteUrl);
      expect(request.request.body).toEqual({ run_id: id });
      request.flush({ ...deleted, deleted: wasDeleted });
      refreshed(wasDeleted ? ['second'] : [id, 'second']);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.state.result()?.deleted).toBe(wasDeleted);
      expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(
        wasDeleted ? 'Informe eliminado' : 'CORE no confirmó',
      );
      if (wasDeleted) {
        expect(panel.open()).toBe(false);
        expect(component.state.selectedId()).toBeNull();
        expect(opener.isConnected).toBe(false);
        panel.didDismiss();
        await new Promise((resolve) => setTimeout(resolve));
        expect(document.activeElement).toBe(component.listHeading()?.nativeElement);
      } else {
        expect(panel.open()).toBe(true);
        expect(component.state.selectedId()).toBe(id);
        expect(
          fixture.nativeElement.querySelector('app-side-panel [role="status"]')?.textContent,
        ).toContain('CORE no confirmó');
        expect(
          fixture.nativeElement.querySelector('[data-testid="report-markdown"]')?.textContent,
        ).toBe(report.markdown);
        expect(document.activeElement).toBe(remove);
      }
    },
  );

  it.each([id, 'second'])(
    'rejects the old reader response after closing and opening %j',
    async (nextId) => {
      const fixture = entry();
      const facade = fixture.componentInstance.state;
      facade.openReportDetail(id);
      const old = http.expectOne(getUrl());
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.directive(SidePanel))
        .componentInstance as SidePanel;
      panel.closed.emit();
      expect(facade.reports.detailLoading()).toBe(false);
      expect(facade.reports.selectedId()).toBeNull();
      facade.openReportDetail(nextId);
      http.expectNone(getUrl(nextId));
      old.flush(report);
      const fresh = http.expectOne(getUrl(nextId));
      fixture.detectChanges();
      expect(facade.reports.detail()).toBeNull();
      expect(facade.reports.detailLoading()).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="report-markdown"]')).toBeNull();
      fresh.flush({ run_id: nextId, markdown: '# Nuevo\n\n  detalle' });
      fixture.detectChanges();
      expect(panel.open()).toBe(true);
      expect(facade.reports.selectedId()).toBe(nextId);
      expect(
        fixture.nativeElement.querySelector('[data-testid="report-markdown"]')?.textContent,
      ).toBe('# Nuevo\n\n  detalle');
      panel.closed.emit();
      fixture.detectChanges();
      expect(panel.open()).toBe(false);
      expect(facade.reports.detailLoading()).toBe(false);
      expect(facade.reports.detail()).toBeNull();
    },
  );

  it('closes the reader with its correlated confirmation, restores its opener and ignores a late confirm', async () => {
    const fixture = entry();
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const opener = fixture.nativeElement.querySelector(
      '.report-list button.secondary',
    ) as HTMLButtonElement;
    opener.focus();
    opener.click();
    http.expectOne(getUrl()).flush(report);
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    const component = fixture.debugElement.query(By.directive(BackupReports))
      .componentInstance as BackupReports;
    (
      fixture.nativeElement.querySelector('[panel-actions] button.danger') as HTMLButtonElement
    ).click();
    const context = dialogs.config!.context;
    panel.didDismiss();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(panel.open()).toBe(false);
    expect(dialogs.element).toBeNull();
    expect(component.state.pending()).toBeNull();
    expect(component.state.selectedId()).toBeNull();
    expect(component.state.detail()).toBeNull();
    expect(component.state.entries()).toEqual([id, 'second']);
    expect(document.activeElement).toBe(opener);
    TestBed.inject(ArcaActionsService).dispatchAction('REPORT_DIALOG_CLOSE', {
      option: 'confirm',
      data: { context },
    });
    component.confirm();
    http.expectNone(deleteUrl);
  });

  it('keeps a sent deletion and Health refresh after closing without affecting another panel', async () => {
    const { fixture, page, reports, component } = await reportView();
    component.prepare(id);
    component.confirm();
    const request = http.expectOne(deleteUrl);
    page.state.closeReportDetail();
    expect(reports.writing()).toBe(true);
    page.state.panel.set('health-run');
    request.flush(deleted);
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush([id, 'second']);
    http.expectNone(getUrl());
    fixture.detectChanges();
    expect(page.state.panel()).toBe('health-run');
    expect(reports.selectedId()).toBeNull();
    expect(reports.detail()).toBeNull();
    expect(reports.result()).toEqual(deleted);
    expect(reports.writing()).toBe(false);
    expect(page.state.operationsBlocked()).toBe(false);
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(
      'Informe eliminado',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="report-markdown"]')).toBeNull();
  });

  it('keeps uncertainty visible after closing, changing tabs and refreshing without retry', async () => {
    const { fixture, page, reports, component } = await reportView();
    component.prepare(id);
    dialogs.choose('confirm');
    http
      .expectOne(deleteUrl)
      .flush({ detail: { code: 'core_timeout' } }, { status: 504, statusText: 'Timeout' });
    fixture.detectChanges();
    const warning = reports.uncertainties()[0];
    expect(
      fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
    ).toContain(warning);
    page.state.closeReportDetail();
    component.ionViewWillLeave();
    component.ionViewWillEnter();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(warning);
    page.state.openReportDetail(id);
    http.expectOne(getUrl()).flush(report);
    reports.refresh();
    http.expectOne(listUrl).flush([id, 'second']);
    http.expectOne(getUrl()).flush(report);
    fixture.detectChanges();
    expect(reports.uncertainties()).toEqual([warning]);
    expect(reports.disabled()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
    ).toContain(warning);
    http.expectNone(deleteUrl);
  });

  it('keeps previous reader text stale on failed refresh and closes only when selection disappears', async () => {
    const { fixture, page, reports } = await reportView();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    reports.refresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-side-panel')?.textContent).toContain(
      'Informe anterior, desactualizado',
    );
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(panel.open()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid="report-markdown"]')?.textContent,
    ).toBe(report.markdown);
    reports.refresh();
    http.expectOne(listUrl).flush([id]);
    http.expectOne(getUrl()).flush({}, { status: 502, statusText: 'Failed' });
    fixture.detectChanges();
    expect(panel.open()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
    ).toContain('Error de consulta');
    reports.refresh();
    http.expectOne(listUrl).flush([]);
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    expect(page.state.panel()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No hay informes de Health');
  });
});
