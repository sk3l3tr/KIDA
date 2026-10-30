import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { BackupsService } from './backups.service';
import { Backups, backupFailure, limitedPrecision } from './backups';
import { BackupJob } from './backups.models';
import { createBody, emptyForm, newCommand, newTarget, parseJson } from './backups-form';
import { backupActions } from './backups.actions';

const base = `${environment.apiBaseUrl}/backup`;
const job: BackupJob = {
  id: 'id /?&+#ñ',
  name: '<img src=x onerror="alert(1)">',
  sources: ['/srv/a'],
  targets: [{ path: '/mnt/backups', required: false, filesystem_uuid: null, future: 1 }],
  compression: 'future-compression',
  lifecycle: { pre_backup: [], post_backup: [], future: null },
  schedule: null,
  retention: null,
  future: { value: 9007199254740992 },
};
function setup() {
  TestBed.configureTestingModule({
    imports: [Backups],
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
function validForm() {
  const form = emptyForm();
  form.name = ' daily ';
  form.sources = [{ path: ' /srv/data ' }];
  form.targets[0].path = ' /mnt/backups ';
  return form;
}
function fail(status: number, code?: string) {
  return new HttpErrorResponse({ status, error: { detail: { code, message: 'rejected' } } });
}

describe('Backups form contracts', () => {
  it('omits disabled options and preserves exact strings and required default', () => {
    expect(createBody(validForm())).toEqual({
      name: ' daily ',
      sources: [' /srv/data '],
      targets: [{ path: ' /mnt/backups ', required: true }],
      compression: 'tar_zstd',
    });
  });
  it('builds the full form including false, null, zero and lifecycle JSON', () => {
    const form = validForm();
    form.targets[0].required = false;
    form.targets[0].filesystem_uuid = { mode: 'null', value: '' };
    form.targets.push({
      ...newTarget(),
      path: '/second',
      filesystem_uuid: { mode: 'value', value: ' uuid ' },
    });
    form.lifecycleEnabled = true;
    form.pre_backup = [
      { command: ' command ', params: { mode: 'value', value: '{"a":[1,true,null]}' } },
    ];
    form.post_backup = [{ command: 'post', params: { mode: 'null', value: '' } }, newCommand()];
    form.schedule = { mode: 'value', value: '{"future":null}' };
    form.retention = 'value';
    form.max_age = { mode: 'null', value: '' };
    form.keep_last = { mode: 'value', value: '0' };
    form.protected_restore_points = [{ path: ' point ' }];
    const body = createBody(form);
    expect(body.targets).toEqual([
      { path: ' /mnt/backups ', required: false, filesystem_uuid: null },
      { path: '/second', required: true, filesystem_uuid: ' uuid ' },
    ]);
    expect(body.lifecycle).toEqual({
      pre_backup: [{ command: ' command ', params: { a: [1, true, null] } }],
      post_backup: [{ command: 'post', params: null }, { command: '' }],
    });
    expect(body.schedule).toEqual({ future: null });
    expect(body.retention).toEqual({
      max_age: null,
      keep_last: 0,
      protected_restore_points: [' point '],
    });
  });
  it('distinguishes null from omission and preserves empty retention and lifecycle', () => {
    const form = validForm();
    form.schedule.mode = 'null';
    form.retention = 'null';
    expect(createBody(form)).toMatchObject({ schedule: null, retention: null });
    form.retention = 'value';
    form.lifecycleEnabled = true;
    expect(createBody(form)).toMatchObject({
      retention: { protected_restore_points: [] },
      lifecycle: { pre_backup: [], post_backup: [] },
    });
    form.keep_last = { mode: 'null', value: '' };
    form.max_age = { mode: 'value', value: ' 7d ' };
    expect(createBody(form).retention).toEqual({
      protected_restore_points: [],
      keep_last: null,
      max_age: ' 7d ',
    });
  });
  it.each(['null', '[]', 'true', '1.25', '9007199254740991', '{"x":"😀"}'])(
    'accepts JSON %s',
    (value) => expect(parseJson(value)).toEqual(JSON.parse(value)),
  );
  it.each([
    '',
    '{',
    'NaN',
    '1e400',
    '9007199254740992',
    '{"x":9007199254740993}',
    '"\\ud800"',
    '{"\\ud800":1}',
  ])('rejects invalid or lossy JSON %s', (value) => expect(() => parseJson(value)).toThrow('JSON'));
  it.each(['-1', '1.2', '4294967296', '1e2', ''])('rejects keep_last %s', (value) => {
    const form = validForm();
    form.retention = 'value';
    form.keep_last = { mode: 'value', value };
    expect(() => createBody(form)).toThrow('keep_last');
  });
  it('accepts UInt32 maximum and does not interpret domain-specific paths or strings', () => {
    const form = validForm();
    form.retention = 'value';
    form.keep_last = { mode: 'value', value: '4294967295' };
    expect(createBody(form).retention?.keep_last).toBe(4294967295);
    form.name = '';
    form.sources = [];
    form.targets = [];
    expect(createBody(form).name).toBe('');
  });
  it('rejects broken Unicode in string fields and invalid option states', () => {
    const form = validForm();
    form.name = '\ud800';
    expect(() => createBody(form)).toThrow('Unicode');
    form.name = 'a';
    form.schedule.mode = 'bad' as never;
    expect(() => createBody(form)).toThrow('opción');
  });
  it('warns only for unsafe integer responses and distinguishes failure types', () => {
    expect(limitedPrecision(job)).toBe(true);
    expect(limitedPrecision({ x: 1.5, y: null })).toBe(false);
    for (const status of [0, 500, 504])
      expect(backupFailure(fail(status), true)).toContain('No se pudo confirmar');
    expect(backupFailure(fail(503, 'core_unavailable'), true)).toContain('Sin conexión');
    expect(backupFailure(fail(502, 'core_error'), true)).toContain('CORE rechazó');
    expect(backupFailure(fail(422), true)).toContain('Validación HTTP');
    expect(backupFailure(fail(401), true)).toContain('sesión');
  });
});

describe('Backups through real ARCA transport', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());
  it('registers fourteen independent channels and preserves open read responses', () => {
    expect(backupActions.map((a) => a.actionName)).toEqual([
      'BACKUP_CONFIG_LIST_REQUEST',
      'BACKUP_CONFIG_CREATE_REQUEST',
      'BACKUP_CONFIG_DELETE_REQUEST',
      'BACKUP_RUN_REQUEST',
      'BACKUP_HEALTH_LIST_REQUEST',
      'BACKUP_HEALTH_GET_REQUEST',
      'BACKUP_HEALTH_CREATE_REQUEST',
      'BACKUP_HEALTH_START_REQUEST',
      'BACKUP_HEALTH_RUN_REQUEST',
      'BACKUP_HEALTH_STOP_REQUEST',
      'BACKUP_HEALTH_DELETE_REQUEST',
      'BACKUP_HEALTH_REPORT_LIST_REQUEST',
      'BACKUP_HEALTH_REPORT_GET_REQUEST',
      'BACKUP_HEALTH_REPORT_DELETE_REQUEST',
    ]);
    for (const action of backupActions) expect(action.urlRequest?.useLoader).toBe(false);
    const next = vi.fn();
    TestBed.inject(BackupsService).list().subscribe(next);
    const r = http.expectOne(`${base}/config`);
    expect(r.request.method).toBe('GET');
    expect(r.request.withCredentials).toBe(true);
    const data = { backups: [job], future: null };
    r.flush(data);
    expect(next).toHaveBeenCalledWith(data);
  });
});

describe('Backups page', () => {
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
  function enterPage(view: Backups) {
    view.ionViewWillEnter();
    http.expectOne(`${base}/health/reports`).flush([]);
    http.expectOne(`${base}/health`).flush([]);
  }
  function enter(data = [job]) {
    const fixture = TestBed.createComponent(Backups);
    fixture.detectChanges();
    const view = fixture.componentInstance;
    enterPage(view);
    http.expectOne(`${base}/config`).flush({ backups: data });
    fixture.detectChanges();
    view.form = validForm();
    return fixture;
  }
  it('keeps last data on refresh failure, updates selected details and clears vanished selection', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.select(job.id);
    view.refresh();
    http.expectOne(`${base}/config`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.entries()).toEqual([job]);
    expect(view.selected()).toEqual(job);
    expect(view.listError()).not.toBe('');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Datos anteriores');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    view.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [{ ...job, name: 'changed' }] });
    expect(view.selected()?.name).toBe('changed');
    view.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(view.selected()).toBeNull();
    expect(view.selectedId()).toBeNull();
  });
  it('distinguishes initial error, empty and loading without overlapping requests', () => {
    const fixture = TestBed.createComponent(Backups);
    fixture.detectChanges();
    const view = fixture.componentInstance;
    enterPage(view);
    view.refresh();
    const r = http.expectOne(`${base}/config`);
    expect(view.loading()).toBe(true);
    r.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.entries()).toBeNull();
    expect(view.updated()).toBeNull();
    view.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(view.entries()).toEqual([]);
    expect(view.listError()).toBe('');
  });
  it('creates once, resets form on success and distinguishes post-write refresh failure', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.create();
    view.create();
    view.refresh();
    const r = http.expectOne(`${base}/config/create`);
    http.expectNone(`${base}/config`);
    r.flush(job);
    expect(view.form).toEqual(emptyForm());
    expect(view.resultLabel()).toContain('creada');
    expect(view.loading()).toBe(true);
    view.create();
    http.expectNone(`${base}/config/create`);
    http.expectOne(`${base}/config`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.result()).toEqual(job);
    expect(view.listError()).not.toBe('');
    expect(view.selected()).toEqual(job);
  });
  it.each([422, 504, 0])('retains form after failed create %s and never retries', (status) => {
    const view = enter().componentInstance,
      form = structuredClone(view.form);
    view.create();
    const r = http.expectOne(`${base}/config/create`);
    if (status === 0) r.error(new ProgressEvent('error'));
    else r.flush({}, { status, statusText: 'Failed' });
    expect(view.form).toEqual(form);
    expect(view.busy()).toBe(false);
    expect(status === 422 ? view.error() : view.uncertainties().join()).toContain(
      status === 422 ? 'Validación' : 'No se pudo confirmar',
    );
    http.expectNone(`${base}/config/create`);
    http.expectNone(`${base}/config`);
  });
  it('blocks invalid JSON before dispatch', () => {
    const view = enter().componentInstance;
    view.form.schedule = { mode: 'value', value: '{' };
    view.create();
    http.expectNone(`${base}/config/create`);
    expect(view.error()).toContain('JSON');
    expect(view.busy()).toBe(false);
  });
  it.each(['run', 'delete'] as const)(
    'freezes %s confirmation, cancels without dispatch and consumes it once',
    (action) => {
      const fixture = enter(),
        view = fixture.componentInstance,
        copy = structuredClone(job);
      view.prepare(action, copy);
      view.refresh();
      view.create();
      http.expectNone(`${base}/config`);
      http.expectNone(`${base}/config/create`);
      copy.id = 'changed';
      expect(view.pending()?.id).toBe(job.id);
      expect(Object.isFrozen(view.pending())).toBe(true);
      view.cancel();
      view.confirm();
      http.expectNone(`${base}/${action === 'run' ? 'run' : 'config/delete'}`);
      view.prepare(action, job);
      view.confirm();
      view.confirm();
      const r = http.expectOne(`${base}/${action === 'run' ? 'run' : 'config/delete'}`);
      expect(r.request.body).toEqual({ id: job.id });
      r.flush(action === 'run' ? { state: 'QUEUED', execution_id: 'execution' } : job);
      http.expectOne(`${base}/config`).flush({ backups: action === 'delete' ? [] : [job] });
      expect(view.resultLabel()).toContain(
        action === 'run' ? 'no confirma inicio ni finalización' : 'archivos se conservan',
      );
    },
  );
  it('preserves uncertain admission across successful refreshes and later writes', () => {
    const view = enter().componentInstance;
    view.prepare('run', job);
    view.confirm();
    http.expectOne(`${base}/run`).flush({}, { status: 504, statusText: 'Timeout' });
    const warning = view.uncertainties()[0];
    expect(warning).toContain(job.id);
    view.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(view.uncertainties()).toEqual([warning]);
    view.prepare('run', job);
    view.confirm();
    http.expectOne(`${base}/run`).flush({ state: 'FUTURE', execution_id: 'future' });
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(view.resultLabel()).toContain('FUTURE');
    expect(view.uncertainties()).toEqual([warning]);
  });
  it('fails closed if the confirmation cannot open', () => {
    const view = enter().componentInstance;
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementationOnce(() => {
      throw new Error();
    });
    view.prepare('delete', job);
    view.confirm();
    expect(view.pending()).toBeNull();
    expect(view.busy()).toBe(false);
    expect(view.error()).toContain('confirmación');
    http.expectNone(`${base}/config/delete`);
  });
  it('clears selection, data, form and dialogs on leave or session change', () => {
    const view = enter().componentInstance;
    view.select(job.id);
    view.prepare('run', job);
    view.ionViewWillLeave();
    view.confirm();
    expect(view.entries()).toBeNull();
    expect(view.form).toEqual(emptyForm());
    expect(view.selectedId()).toBeNull();
    expect(view.pending()).toBeNull();
    http.expectNone(`${base}/run`);
    enterPage(view);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    view.prepare('delete', job);
    TestBed.inject(ThemeIdentity).clear();
    view.confirm();
    view.refresh();
    expect(view.entries()).toBeNull();
    expect(view.pending()).toBeNull();
    http.expectNone(`${base}/config/delete`);
    http.expectNone(`${base}/config`);
  });

  it('focuses Cancel before rendering the pending snapshot and restores the trigger on cancel', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('.backup-list button') as HTMLButtonElement;
    trigger.focus();
    view.prepare('run', job);
    expect(document.activeElement?.textContent?.trim()).toBe('Cancelar');
    view.cancel();
    TestBed.tick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
    http.expectNone(`${base}/run`);
  });
  it('restores the enabled submit button after the post-create refresh', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    trigger.focus();
    view.create();
    http.expectOne(`${base}/config/create`).flush(job);
    fixture.detectChanges();
    expect(trigger.matches(':disabled')).toBe(true);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    TestBed.tick();
    await fixture.whenStable();
    expect(trigger.matches(':disabled')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
  it('focuses the list heading if deletion removes the trigger', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector(
      '.backup-list .danger',
    ) as HTMLButtonElement;
    trigger.focus();
    view.prepare('delete', job);
    view.confirm();
    http.expectOne(`${base}/config/delete`).flush(job);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    TestBed.tick();
    await fixture.whenStable();
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement?.id).toBe('backup-configurations-heading');
  });

  it('clears the DOM of an Ionic cached detached page on session change', async () => {
    const fixture = enter();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.backup-list li').length).toBe(1);
    const name = fixture.nativeElement.querySelector('#backup-name') as HTMLInputElement;
    name.value = ' cached form ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.form.name).toBe(' cached form ');
    expect(name.value).toBe(' cached form ');
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(fixture.componentInstance.entries()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.backup-list li').length).toBe(0);
    expect(fixture.nativeElement.querySelector('#backup-name')).toBeNull();
    enterPage(fixture.componentInstance);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    fixture.changeDetectorRef.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#backup-name').value).toBe('');
  });
});
