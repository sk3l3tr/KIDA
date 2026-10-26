import { DeferBlockState, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { AuthService } from '../../auth/auth.service';
import { ChannelBusyError } from '../../services/arca-request.service';
import { BackupsService } from './backups.service';
import { Backups } from './backups';
import { BackupReports } from './reports';
import { HealthReport } from './reports.models';

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
const operations = ['list', 'get', 'delete'] as const;
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
        }),
      },
      { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return TestBed.inject(HttpTestingController);
}

describe('Health report contracts through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());
  it('reads a root array and an encoded ID, preserving Markdown and extra null fields', () => {
    const service = TestBed.inject(BackupsService),
      list = vi.fn(),
      detail = vi.fn();
    service.reportList().subscribe(list);
    const first = http.expectOne(listUrl);
    expect(first.request.method).toBe('GET');
    expect(first.request.withCredentials).toBe(true);
    first.flush([id]);
    expect(list).toHaveBeenCalledWith([id]);
    service.reportGet(id).subscribe(detail);
    const second = http.expectOne(getUrl());
    expect(second.request.method).toBe('GET');
    expect(second.request.withCredentials).toBe(true);
    second.flush(report);
    expect(detail).toHaveBeenCalledWith(report);
    for (const name of ['LIST', 'GET'])
      for (const suffix of ['REQUEST', 'RESPONSE', 'ERROR'])
        expect(
          TestBed.inject(ArcaActionsService).getDataSnapshot(
            `BACKUP_HEALTH_REPORT_${name}_${suffix}`,
          ),
        ).toBe('undefined');
  });
  it('deletes only the exact run_id with cookie/CSRF and preserves deleted:false', () => {
    TestBed.inject(AuthService).csrfToken.set('report-csrf');
    const next = vi.fn();
    TestBed.inject(BackupsService).reportDelete(id).subscribe(next);
    const request = http.expectOne(deleteUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ run_id: id });
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('report-csrf');
    request.flush({ ...deleted, deleted: false });
    expect(next).toHaveBeenCalledWith({ ...deleted, deleted: false });
    expect(TestBed.inject(ArcaPanelsService).showLoader).not.toHaveBeenCalled();
    for (const name of ['DELETE'])
      for (const suffix of ['REQUEST', 'RESPONSE', 'ERROR'])
        expect(
          TestBed.inject(ArcaActionsService).getDataSnapshot(
            `BACKUP_HEALTH_REPORT_${name}_${suffix}`,
          ),
        ).toBe('undefined');
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
  it.each(operations)(
    'drains abandoned %s, rejects busy reuse and isolates new sessions',
    (operation) => {
      const service = TestBed.inject(BackupsService);
      const send = (): Observable<unknown> =>
        operation === 'list'
          ? service.reportList()
          : operation === 'get'
            ? service.reportGet(id)
            : service.reportDelete(id);
      const url = operation === 'list' ? listUrl : operation === 'get' ? getUrl() : deleteUrl;
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
        data = operation === 'list' ? [id] : operation === 'get' ? report : deleted;
      first.flush(data);
      expect(old).not.toHaveBeenCalled();
      expect(fresh).not.toHaveBeenCalled();
      second.flush(data);
      expect(fresh).toHaveBeenCalledWith(data);
    },
  );
});

describe('Health report state, confirmation and page integration', () => {
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
    page.reports.select(id);
    http.expectOne(getUrl()).flush(report);
  }
  function refreshed(rows = [id, 'second']) {
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush(rows);
    if (rows.includes(id)) http.expectOne(getUrl()).flush(report);
  }
  async function reportView() {
    const page = entry().componentInstance;
    select(page);
    const fixture = TestBed.createComponent(BackupReports);
    fixture.componentRef.setInput('state', page.reports);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return { page, reports: page.reports, fixture, component: fixture.componentInstance };
  }
  it('loads on entry without polling and distinguishes initial failure, retry and empty', () => {
    const fixture = TestBed.createComponent(Backups),
      page = fixture.componentInstance;
    fixture.detectChanges();
    page.ionViewWillEnter();
    page.reports.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(page.reports.entries()).toBeNull();
    expect(page.reports.updated()).toBeNull();
    expect(page.reports.listError()).not.toBe('');
    page.reports.refresh();
    http.expectOne(listUrl).flush([]);
    expect(page.reports.entries()).toEqual([]);
    expect(page.reports.listError()).toBe('');
    http.expectNone(listUrl);
  });
  it('retains stale reads on errors and clears selection only after successful disappearance', () => {
    const page = entry().componentInstance,
      reports = page.reports;
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
      reports = page.reports;
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
    expect(page.operationsBlocked()).toBe(true);
    expect(page.health.disabled()).toBe(true);
    page.refresh();
    page.create();
    page.health.create();
    page.health.refresh();
    reports.refresh();
    reports.select('second');
    http.expectNone(`${base}/config`);
    http.expectNone(`${base}/config/create`);
    http.expectNone(`${base}/health/create`);
    http.expectNone(`${base}/health`);
    http.expectNone(listUrl);
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(reports.pending()).toBeNull();
    expect(dialog.open).toBe(false);
    http.expectNone(deleteUrl);
    component.prepare(id);
    reports.selectedId.set('second');
    reports.detail.set({ run_id: 'second', markdown: 'changed' });
    fixture.detectChanges();
    expect(dialog.querySelector('pre')?.textContent).toContain(id);
    component.confirm();
    component.confirm();
    reports.confirm();
    const request = http.expectOne(deleteUrl);
    expect(request.request.body).toEqual({ run_id: id });
    expect(dialog.open).toBe(false);
    request.flush(deleted);
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(listUrl).flush(['second']);
    http.expectOne(getUrl('second')).flush({ run_id: 'second', markdown: 'changed' });
    expect(reports.result()).toEqual(deleted);
    expect(reports.occupied()).toBe(false);
  });
  it('fails closed when the dialog cannot open', async () => {
    const { reports, fixture, component } = await reportView();
    vi.spyOn(fixture.nativeElement.querySelector('dialog'), 'showModal').mockImplementation(() => {
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
        reports = page.reports;
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
      reports = page.reports;
    select(page);
    reports.prepare(id);
    reports.confirm();
    http.expectOne(deleteUrl).flush(deleted);
    http.expectOne(listUrl).flush({}, { status: 503, statusText: 'Unavailable' });
    http.expectOne(`${base}/health`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(reports.result()).toEqual(deleted);
    expect(reports.listError()).not.toBe('');
    expect(page.health.listError()).not.toBe('');
    expect(reports.detail()).toEqual(report);
  });
  it('refreshes selected Health report status and path after report deletion', () => {
    const page = entry().componentInstance;
    page.health.refresh();
    http.expectOne(`${base}/health`).flush([{ run_id: 'health-id', report_status: 'READY' }]);
    page.health.select('health-id');
    http
      .expectOne(`${base}/health/get?run_id=health-id`)
      .flush({ run_id: 'health-id', report_path: '/old/report.md' });
    page.reports.prepare(id);
    page.reports.confirm();
    http.expectOne(deleteUrl).flush(deleted);
    expect(page.health.occupied()).toBe(true);
    http.expectOne(`${base}/health`).flush([{ run_id: 'health-id', report_status: 'MISSING' }]);
    http
      .expectOne(`${base}/health/get?run_id=health-id`)
      .flush({ run_id: 'health-id', report_path: null });
    http.expectOne(listUrl).flush([]);
    expect(page.health.selectedHistory()?.report_status).toBe('MISSING');
    expect(page.health.detail()?.report_path).toBeNull();
    expect(page.reports.result()).toEqual(deleted);
    expect(page.operationsBlocked()).toBe(false);
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
        reports = page.reports;
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
      reports = page.reports;
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
      reports = page.reports;
    page.prepare('run', { id: 'b', name: 'name' } as never);
    reports.refresh();
    reports.select(id);
    reports.prepare(id);
    expect(reports.disabled()).toBe(true);
    expect(reports.pending()).toBeNull();
    http.expectNone(listUrl);
    http.expectNone(getUrl());
    page.confirm();
    reports.refresh();
    http.expectOne(`${base}/run`).flush({ state: 'QUEUED', execution_id: 'e' });
    reports.refresh();
    http.expectNone(listUrl);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(reports.disabled()).toBe(false);
  });
  it('blocks Reports while Health reads or writes, and blocks Health/config during report reads', () => {
    const page = entry().componentInstance,
      reports = page.reports;
    page.health.refresh();
    reports.refresh();
    reports.prepare(id);
    expect(reports.pending()).toBeNull();
    http.expectNone(listUrl);
    http.expectOne(`${base}/health`).flush([]);
    page.health.create();
    reports.refresh();
    http.expectNone(listUrl);
    http.expectOne(`${base}/health/create`).flush({}, { status: 422, statusText: 'Invalid' });
    reports.select(id);
    page.refresh();
    page.health.refresh();
    page.health.create();
    http.expectNone(`${base}/config`);
    http.expectNone(`${base}/health`);
    http.expectNone(`${base}/health/create`);
    http.expectOne(getUrl()).flush(report);
    expect(page.operationsBlocked()).toBe(false);
  });
  it.each(operations)('ignores late %s on leave and isolates a fresh session', (operation) => {
    const page = entry().componentInstance,
      reports = page.reports;
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
    initial();
    send();
    const fresh = http.expectOne(url);
    old.flush(operation === 'list' ? [id] : operation === 'get' ? report : deleted);
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
  it.each(operations)(
    'handles busy %s on same-session re-entry and recovers after draining',
    (operation) => {
      const page = entry().componentInstance,
        reports = page.reports;
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
      page.ionViewWillEnter();
      http.expectOne(`${base}/config`).flush({ backups: [] });
      http.expectOne(`${base}/health`).flush([]);
      if (operation !== 'list') {
        http.expectOne(listUrl).flush([id]);
        send();
      }
      expect(reports.listError() + reports.detailError() + reports.error()).toContain('pendiente');
      old.flush(operation === 'list' ? [id] : operation === 'get' ? report : deleted);
      expect(reports.result()).toBeNull();
      expect(reports.detail()).toBeNull();
      send();
      http
        .expectOne(url)
        .flush(operation === 'list' ? [id] : operation === 'get' ? report : deleted);
      if (operation === 'delete') refreshed([]);
      expect(reports.occupied()).toBe(false);
      expect(reports.listError() + reports.detailError() + reports.error()).toBe('');
    },
  );
  it('rejects malformed Unicode before opening or dispatching', async () => {
    const { reports, fixture, component } = await reportView();
    component.prepare('\ud800');
    component.confirm();
    expect(reports.error()).toContain('Unicode');
    expect(reports.pending()).toBeNull();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    http.expectNone(deleteUrl);
  });
  it.each(['leave', 'session'] as const)(
    'clears pending confirmation on %s and cannot send later',
    async (reason) => {
      const { page, reports, fixture, component } = await reportView();
      component.prepare(id);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
      if (reason === 'leave') page.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).clear();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
      expect(reports.pending()).toBeNull();
      expect(reports.detail()).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain(report.markdown);
      component.confirm();
      http.expectNone(deleteUrl);
    },
  );
  it.each([200, 502, 504])(
    'traps keyboard and restores operation focus after %s',
    async (status) => {
      const { reports, fixture, component } = await reportView();
      const trigger = [...fixture.nativeElement.querySelectorAll('button')].find(
        (button: any) => button.getAttribute('aria-label') === `Eliminar informe ${id}`,
      ) as HTMLButtonElement;
      trigger.focus();
      component.prepare(id);
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
    const blocks = await fixture.getDeferBlocks();
    await blocks[1].render(DeferBlockState.Complete);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.debugElement.query(
      (element) => element.componentInstance instanceof BackupReports,
    ).componentInstance as BackupReports;
    component.prepare(id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-backup-reports dialog').open).toBe(true);
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(page.reports.entries()).toBeNull();
    expect(page.reports.detail()).toBeNull();
    expect(page.reports.pending()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-backup-reports')).toBeNull();
  });
});
