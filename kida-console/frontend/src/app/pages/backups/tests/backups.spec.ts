import { BackupConfigurations } from '../tabs/backup-configurations/backup-configurations';
import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';
import { By } from '@angular/platform-browser';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { BackupsService } from '../services/backups.service';
import { Backups } from '../backups';
import { backupFailure, limitedPrecision } from '../utils/backups-presentation';
import { BackupJob } from '../utils/backups.models';
import { createBody, emptyForm, newCommand, newTarget, parseJson } from '../utils/backups-form';
import { backupActions } from '../utils/backups.actions';

let dialogs: ReturnType<typeof mockArcaDialogs>;
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
          modals: inject(ArcaModalService),
        }),
      },
      { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(Backups, {
    set: {
      imports: [BackupConfigurations],
      template: '@if (state.active()) { <app-backup-configurations /> }',
    },
  });
  TestBed.overrideComponent(SidePanel, {
    set: { template: '@if (open()) { <ng-content /><ng-content select="[panel-actions]" /> }' },
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  dialogs = mockArcaDialogs();
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
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });
  it('drains a sent read, discards cancelled queued work and leaves other channels independent', () => {
    const service = TestBed.inject(BackupsService);
    const first = service.reportGet('first').subscribe();
    const old = http.expectOne(`${base}/health/reports/get?run_id=first`);
    first.unsubscribe();
    const cancelled = service.reportGet('cancelled').subscribe();
    cancelled.unsubscribe();
    const next = vi.fn();
    service.reportGet('latest').subscribe(next);
    service.healthList().subscribe();
    http.expectOne(`${base}/health`).flush([]);
    http.expectNone(`${base}/health/reports/get?run_id=latest`);
    old.flush({ run_id: 'first', markdown: 'old' });
    expect(next).not.toHaveBeenCalled();
    http.expectNone(`${base}/health/reports/get?run_id=cancelled`);
    const current = { run_id: 'latest', markdown: 'new' };
    http.expectOne(`${base}/health/reports/get?run_id=latest`).flush(current);
    expect(next).toHaveBeenCalledExactlyOnceWith(current);
  });
  it('keeps a channel usable after failure and never dispatches a cancelled queued write', () => {
    const service = TestBed.inject(BackupsService);
    const error = vi.fn();
    service.run('first').subscribe({ error });
    const old = http.expectOne(`${base}/run`);
    const cancelled = service.run('cancelled').subscribe();
    cancelled.unsubscribe();
    const next = vi.fn();
    service.run('latest').subscribe(next);
    old.flush({}, { status: 504, statusText: 'Timeout' });
    expect(error).toHaveBeenCalledOnce();
    const current = http.expectOne(`${base}/run`);
    expect(current.request.body).toEqual({ id: 'latest' });
    current.flush({ state: 'QUEUED', execution_id: 'new' });
    expect(next).toHaveBeenCalledExactlyOnceWith({ state: 'QUEUED', execution_id: 'new' });
    http.expectNone(`${base}/run`);
  });
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
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
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
    view.state.configurations.form = validForm();
    return fixture;
  }
  function openCreate(fixture: ComponentFixture<Backups>): SidePanel {
    fixture.nativeElement.querySelector('.section-header button').click();
    fixture.detectChanges();
    return fixture.debugElement.query(By.directive(SidePanel)).componentInstance as SidePanel;
  }
  it('opens a single creation form in the panel and preserves the complete draft across closing and tabs', async () => {
    const fixture = enter();
    const facade = fixture.componentInstance.state;
    const draft = validForm();
    draft.targets[0].required = false;
    draft.targets[0].filesystem_uuid = { mode: 'value', value: ' UUID ñ exacto ' };
    draft.lifecycleEnabled = true;
    draft.pre_backup = [{ command: ' antes ', params: { mode: 'value', value: 'false' } }];
    draft.post_backup = [{ command: ' después ', params: { mode: 'null', value: '' } }];
    draft.schedule = { mode: 'value', value: '{"futuro":0}' };
    draft.retention = 'value';
    draft.max_age = { mode: 'null', value: '' };
    draft.keep_last = { mode: 'value', value: '0' };
    draft.protected_restore_points = [{ path: ' punto 😀 ' }];
    facade.configurations.form = draft;
    const original = structuredClone(draft);
    expect(fixture.nativeElement.querySelector('app-backup-create-form')).toBeNull();
    const panel = openCreate(fixture);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(panel.open()).toBe(true);
    expect(panel.title()).toBe('Nueva configuración');
    expect(facade.panel()).toBe('configuration-create');
    expect(
      fixture.nativeElement.querySelectorAll('app-side-panel app-backup-create-form'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('app-backup-create-form details').open).toBe(false);
    expect(fixture.nativeElement.querySelector('#backup-name').value).toBe(draft.name);
    panel.closed.emit();
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    openCreate(fixture);
    expect(facade.configurations.form).toEqual(original);
    facade.leaveTab();
    fixture.detectChanges();
    expect(facade.panel()).toBeNull();
    expect(facade.configurations.form).toEqual(original);
    openCreate(fixture);
    const form = fixture.nativeElement.querySelector(
      'app-backup-create-form form',
    ) as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const request = http.expectOne(`${base}/config/create`);
    expect(request.request.body).toEqual(createBody(original));
    request.flush(job);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
  });
  it('submits once from panel actions, closes only after confirmed creation and preserves success after refresh failure', async () => {
    const fixture = enter();
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const origin = fixture.nativeElement.querySelector(
      '.section-header button',
    ) as HTMLButtonElement;
    origin.focus();
    const panel = openCreate(fixture);
    const state = fixture.componentInstance.state.configurations;
    const submit = fixture.nativeElement.querySelector(
      '[panel-actions] button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(submit.form?.id).toBe('backup-configuration-form');
    submit.click();
    fixture.detectChanges();
    const request = http.expectOne(`${base}/config/create`);
    expect(panel.open()).toBe(true);
    expect(submit.disabled).toBe(true);
    state.create();
    http.expectNone(`${base}/config/create`);
    request.flush(job);
    const refresh = http.expectOne(`${base}/config`);
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    expect(fixture.componentInstance.state.panel()).toBeNull();
    expect(state.form).toEqual(emptyForm());
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(
      'Configuración creada',
    );
    panel.didDismiss();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(origin.disabled).toBe(true);
    expect(document.activeElement?.id).toBe('backup-configurations-heading');
    refresh.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(state.result()).toEqual(job);
    expect(state.listError()).not.toBe('');
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(
      'Configuración creada',
    );
  });
  it.each([422, 504, 0])(
    'keeps the creation panel and draft after failure %s with accessible feedback and no retry',
    async (status) => {
      const fixture = enter();
      const state = fixture.componentInstance.state.configurations;
      const draft = structuredClone(state.form);
      const panel = openCreate(fixture);
      await fixture.whenStable();
      fixture.nativeElement
        .querySelector('app-backup-create-form form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const request = http.expectOne(`${base}/config/create`);
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush({}, { status, statusText: 'Failed' });
      fixture.detectChanges();
      expect(panel.open()).toBe(true);
      expect(state.form).toEqual(draft);
      expect(
        fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
      ).toContain(status === 422 ? 'Validación' : 'No se pudo confirmar');
      panel.closed.emit();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        status === 422 ? 'Validación' : 'No se pudo confirmar',
      );
      http.expectNone(`${base}/config/create`);
      http.expectNone(`${base}/config`);
    },
  );
  it('keeps the creation draft and panel for local validation or completion without a confirmed result', () => {
    const fixture = enter();
    const state = fixture.componentInstance.state.configurations;
    const panel = openCreate(fixture);
    state.form.schedule = { mode: 'value', value: '{' };
    const submit = () =>
      fixture.nativeElement
        .querySelector('app-backup-create-form form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    submit();
    fixture.detectChanges();
    expect(panel.open()).toBe(true);
    expect(state.form.schedule.value).toBe('{');
    expect(
      fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
    ).toContain('JSON');
    http.expectNone(`${base}/config/create`);
    state.form = validForm();
    vi.spyOn(TestBed.inject(BackupsService), 'create').mockReturnValue(EMPTY);
    submit();
    fixture.detectChanges();
    expect(panel.open()).toBe(true);
    expect(state.form).toEqual(validForm());
    expect(state.busy()).toBe(false);
    expect(state.result()).toBeNull();
    http.expectNone(`${base}/config`);
  });
  it('keeps another panel and selection untouched when a closed creation succeeds late', () => {
    const fixture = enter();
    const facade = fixture.componentInstance.state;
    const panel = openCreate(fixture);
    fixture.nativeElement
      .querySelector('app-backup-create-form form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const request = http.expectOne(`${base}/config/create`);
    panel.closed.emit();
    fixture.detectChanges();
    expect(facade.configurations.busy()).toBe(true);
    facade.leaveTab();
    facade.panel.set('health-create');
    request.flush(job);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    fixture.detectChanges();
    expect(facade.panel()).toBe('health-create');
    expect(facade.configurations.selectedId()).toBeNull();
    expect(facade.configurations.form).toEqual(emptyForm());
    expect(facade.configurations.result()).toEqual(job);
  });
  it('filters names and every source/target locally without changing server order or data', () => {
    const second = {
      ...job,
      id: 'second',
      name: 'Documentos',
      sources: ['/srv/segundo', '/etc/oculto'],
      targets: [
        { path: '/mnt/uno', required: true },
        { path: '/mnt/dos', required: false },
        { path: '/usb/último', required: true },
      ],
    };
    const fixture = enter([job, second]);
    const original = structuredClone(fixture.componentInstance.state.configurations.entries());
    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    for (const query of ['DOCUMENTOS', '/ETC/OCULTO', '/USB/ÚLTIMO']) {
      search.value = query;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      const cards = fixture.nativeElement.querySelectorAll('.backup-list > li');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('Documentos');
    }
    search.value = 'sin coincidencias';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay coincidencias');
    expect(fixture.nativeElement.textContent).not.toContain('No hay configuraciones de backup.');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.backup-list > li');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain(job.name);
    expect(cards[1].textContent).toContain(second.name);
    expect(fixture.componentInstance.state.configurations.entries()).toEqual(original);
    http.expectNone(`${base}/config`);
  });
  it('summarizes multiple routes and exposes the complete original configuration in the inspector', () => {
    const multiple = {
      ...job,
      sources: ['/a', '/b', '/c'],
      targets: [
        { path: '/one', required: true },
        { path: '/two', required: false, filesystem_uuid: null },
        { path: '/three', required: true, filesystem_uuid: ' UUID exacto ' },
      ],
      schedule: undefined,
      retention: { keep_last: 0, protected_restore_points: ['exact'] },
    };
    const fixture = enter([multiple]);
    const card = fixture.nativeElement.querySelector('.backup-list > li') as HTMLElement;
    expect(card.textContent).toContain('/a');
    expect(card.textContent).not.toContain('/b');
    expect(card.textContent).toContain('+2 orígenes');
    expect(card.textContent).toContain('/one');
    expect(card.textContent).toContain('/two');
    expect(card.textContent).not.toContain('/three');
    expect(card.textContent).toContain('+1 destino');
    expect(card.textContent).toContain('Obligatorio');
    expect(card.textContent).toContain('Opcional');
    card.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    expect(panel.open()).toBe(true);
    const detail = fixture.nativeElement.querySelector('app-side-panel') as HTMLElement;
    for (const text of [
      job.id,
      '/a',
      '/b',
      '/c',
      '/one',
      '/two',
      '/three',
      ' UUID exacto ',
      'Omitido',
      'null',
      'future-compression',
      'Lifecycle',
      'Schedule',
      'Retention',
      'keep_last',
      'protected_restore_points',
      'Precisión limitada',
      'future',
    ]) {
      expect(detail.textContent).toContain(text);
    }
    expect(detail.querySelector('img')).toBeNull();
    expect(detail.textContent).toContain('Solicitar backup');
    expect(detail.textContent).toContain('Eliminar configuración');
  });
  it.each(['run', 'delete'] as const)(
    'confirms %s from the inspector, restores its trap on cancel and blocks duplicates',
    async (action) => {
      const fixture = enter();
      fixture.nativeElement.querySelector('.backup-list button').click();
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.directive(SidePanel))
        .componentInstance as SidePanel;
      const button = Array.from(
        fixture.nativeElement.querySelectorAll(
          'app-side-panel button',
        ) as NodeListOf<HTMLButtonElement>,
      ).find(
        (item) =>
          item.textContent?.trim() ===
          (action === 'run' ? 'Solicitar backup' : 'Eliminar configuración'),
      )!;
      expect(button).toBeDefined();
      button.focus();
      button.click();
      fixture.detectChanges();
      expect(panel.focusTrap()).toBe(false);
      expect(button.disabled).toBe(true);
      expect(String(dialogs.config?.text)).toContain(job.id);
      dialogs.choose('cancel');
      fixture.detectChanges();
      expect(panel.open()).toBe(true);
      expect(panel.focusTrap()).toBe(true);
      await fixture.whenStable();
      expect(document.activeElement).toBe(button);
      http.expectNone(`${base}/${action === 'run' ? 'run' : 'config/delete'}`);
      button.click();
      dialogs.choose();
      fixture.componentInstance.state.configurations.confirm();
      const request = http.expectOne(`${base}/${action === 'run' ? 'run' : 'config/delete'}`);
      expect(request.request.body).toEqual({ id: job.id });
      request.flush(action === 'run' ? { state: 'QUEUED', execution_id: 'queued' } : job);
      http.expectOne(`${base}/config`).flush({ backups: action === 'delete' ? [] : [job] });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(
        action === 'run' ? 'no confirma inicio ni finalización' : 'archivos se conservan',
      );
    },
  );
  it.each([409, 504])(
    'keeps operation feedback accessible inside the configuration inspector after HTTP %s',
    (status) => {
      const fixture = enter();
      const facade = fixture.componentInstance.state;
      facade.openConfigurationDetail(job.id);
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[panel-actions] button').click();
      dialogs.choose();
      http.expectOne(`${base}/run`).flush({}, { status, statusText: 'Failure' });
      fixture.detectChanges();
      const message =
        status === 504 ? facade.configurations.uncertainties()[0] : facade.configurations.error();
      expect(message).toBeTruthy();
      expect(
        fixture.nativeElement.querySelector('app-side-panel [role="alert"]')?.textContent,
      ).toContain(message);
      expect(facade.panel()).toBe('configuration-detail');
      facade.closeConfigurationPanel();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(message);
      facade.configurations.entries.set([{ ...job, id: 'second', name: 'Second' }]);
      facade.openConfigurationDetail('second');
      fixture.detectChanges();
      const inspector = fixture.nativeElement.querySelector('app-side-panel');
      expect(inspector.textContent).toContain('Detalles: Second');
      expect(inspector.textContent).toContain('Pueden corresponder a otra configuración');
      expect(inspector.querySelector('[role="alert"]')?.textContent).toContain(message);
    },
  );

  it('shows the complete admitted backup result inside the open inspector even if its refresh fails', () => {
    const fixture = enter();
    const facade = fixture.componentInstance.state;
    facade.openConfigurationDetail(job.id);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[panel-actions] button').click();
    dialogs.choose();
    http
      .expectOne(`${base}/run`)
      .flush({ state: 'QUEUED', execution_id: 'exact-queue', future: null });
    const refresh = http.expectOne(`${base}/config`);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-side-panel').textContent).toContain(
      'Actualizando configuraciones',
    );
    refresh.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const feedback = fixture.nativeElement.querySelector('app-side-panel [role="status"]');
    expect(feedback?.textContent).toContain('no confirma inicio ni finalización');
    expect(feedback?.textContent).toContain('exact-queue');
    expect(feedback?.textContent).toContain('"future": null');
    const inspector = fixture.nativeElement.querySelector('app-side-panel');
    expect(inspector.textContent).toContain('Última lectura:');
    expect(inspector.textContent).toContain('Configuración anterior, desactualizada');
    expect(inspector.querySelector('[role="alert"]')?.textContent).toContain(
      facade.configurations.listError(),
    );
    expect(facade.panel()).toBe('configuration-detail');
  });

  it('returns focus to the inspector trigger, falling back to the list heading if it disappeared', async () => {
    const fixture = enter();
    fixture.autoDetectChanges();
    await fixture.whenStable();
    let trigger = fixture.nativeElement.querySelector('.backup-list button') as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    panel.didDismiss();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(trigger);
    trigger = fixture.nativeElement.querySelector('.backup-list button');
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    const state = fixture.componentInstance.state.configurations;
    state.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    fixture.detectChanges();
    panel.didDismiss();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.id).toBe('backup-configurations-heading');
  });
  it('closes the inspector and invalidates its confirmation without losing draft, search or messages', () => {
    const fixture = enter();
    const facade = fixture.componentInstance.state;
    facade.search.set('/srv');
    facade.configurations.uncertainties.set(['incertidumbre anterior']);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.backup-list button').click();
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    facade.configurations.prepare('delete', job);
    const draft = structuredClone(facade.configurations.form);
    panel.closed.emit();
    fixture.detectChanges();
    dialogs.choose();
    expect(panel.open()).toBe(false);
    expect(facade.panel()).toBeNull();
    expect(facade.configurations.selected()).toBeNull();
    expect(facade.configurations.pending()).toBeNull();
    expect(facade.configurations.form).toEqual(draft);
    expect(facade.search()).toBe('/srv');
    expect(fixture.nativeElement.textContent).toContain('incertidumbre anterior');
    http.expectNone(`${base}/config/delete`);
  });
  it('does not reopen an inspector after a sent operation completes and closes a vanished selection', () => {
    const fixture = enter();
    const facade = fixture.componentInstance.state;
    fixture.nativeElement.querySelector('.backup-list button').click();
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    facade.configurations.prepare('run', job);
    dialogs.choose();
    const sent = http.expectOne(`${base}/run`);
    panel.closed.emit();
    fixture.detectChanges();
    sent.flush({ state: 'QUEUED', execution_id: 'late' });
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    expect(facade.configurations.selected()).toBeNull();
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain('late');
    fixture.nativeElement.querySelector('.backup-list button').click();
    fixture.detectChanges();
    facade.configurations.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    fixture.detectChanges();
    expect(panel.open()).toBe(false);
    expect(facade.panel()).toBeNull();
    expect(facade.configurations.selected()).toBeNull();
  });
  it('opens another configuration without stale details and opens the existing creation draft in the panel', async () => {
    const fixture = enter([
      job,
      { ...job, id: 'other', name: 'Otra configuración', sources: ['/otra'] },
    ]);
    const buttons = fixture.nativeElement.querySelectorAll('.backup-list > li');
    buttons[0].querySelector('button').click();
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(SidePanel))
      .componentInstance as SidePanel;
    panel.closed.emit();
    fixture.detectChanges();
    buttons[1].querySelector('button').click();
    fixture.detectChanges();
    expect(panel.title()).toContain('Otra configuración');
    expect(fixture.nativeElement.querySelector('app-side-panel').textContent).not.toContain(job.id);
    panel.closed.emit();
    fixture.detectChanges();
    const create = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.trim() === 'Nueva configuración')!;
    expect(create).toBeDefined();
    create.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-side-panel #backup-name')).not.toBeNull();
    expect(fixture.componentInstance.state.configurations.form).toEqual(validForm());
    expect(panel.open()).toBe(true);
    expect(panel.title()).toBe('Nueva configuración');
  });
  it('confirms a backup operation through the shared ARCA action protocol', () => {
    const view = enter().componentInstance;
    view.state.configurations.prepare('run', job);
    expect(dialogs.config?.title).toBe('Confirmar operación de backup');
    dialogs.choose();
    http.expectOne(`${base}/run`).flush({ state: 'QUEUED', execution_id: 'test' });
    http.expectOne(`${base}/config`).flush({ backups: [job] });
  });
  it('submits the extracted configuration form including lifecycle commands', async () => {
    const fixture = enter();
    const configurations = fixture.componentInstance.state.configurations;
    openCreate(fixture);
    configurations.form.pre_backup = [{ command: 'before', params: { mode: 'null', value: '' } }];
    fixture.detectChanges();
    await fixture.whenStable();
    const form = fixture.nativeElement.querySelector(
      'app-backup-create-form form',
    ) as HTMLFormElement;
    (form.querySelector('input[name="backup-lifecycle"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(form.textContent).toContain('Comando pre_backup 1');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const request = http.expectOne(`${base}/config/create`);
    expect(request.request.body).toEqual(createBody(configurations.form));
    request.flush(job);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(configurations.form).toEqual(emptyForm());
  });
  it('keeps last data on refresh failure, updates selected details and clears vanished selection', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.state.configurations.select(job.id);
    view.state.configurations.refresh();
    http.expectOne(`${base}/config`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.state.configurations.entries()).toEqual([job]);
    expect(view.state.configurations.selected()).toEqual(job);
    expect(view.state.configurations.listError()).not.toBe('');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Datos anteriores');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    view.state.configurations.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [{ ...job, name: 'changed' }] });
    expect(view.state.configurations.selected()?.name).toBe('changed');
    view.state.configurations.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(view.state.configurations.selected()).toBeNull();
    expect(view.state.configurations.selectedId()).toBeNull();
  });
  it('distinguishes initial error, empty and loading without overlapping requests', () => {
    const fixture = TestBed.createComponent(Backups);
    fixture.detectChanges();
    const view = fixture.componentInstance;
    enterPage(view);
    view.state.configurations.refresh();
    const r = http.expectOne(`${base}/config`);
    expect(view.state.configurations.loading()).toBe(true);
    r.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.state.configurations.entries()).toBeNull();
    expect(view.state.configurations.updated()).toBeNull();
    view.state.configurations.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    expect(view.state.configurations.entries()).toEqual([]);
    expect(view.state.configurations.listError()).toBe('');
  });
  it('creates once, resets form on success and distinguishes post-write refresh failure', () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    view.state.configurations.create();
    view.state.configurations.create();
    view.state.configurations.refresh();
    const r = http.expectOne(`${base}/config/create`);
    http.expectNone(`${base}/config`);
    r.flush(job);
    expect(view.state.configurations.form).toEqual(emptyForm());
    expect(view.state.configurations.resultLabel()).toContain('creada');
    expect(view.state.configurations.loading()).toBe(true);
    view.state.configurations.create();
    http.expectNone(`${base}/config/create`);
    http.expectOne(`${base}/config`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(view.state.configurations.result()).toEqual(job);
    expect(view.state.configurations.listError()).not.toBe('');
    expect(view.state.configurations.selected()).toEqual(job);
  });
  it.each([422, 504, 0])('retains form after failed create %s and never retries', (status) => {
    const view = enter().componentInstance,
      form = structuredClone(view.state.configurations.form);
    view.state.configurations.create();
    const r = http.expectOne(`${base}/config/create`);
    if (status === 0) r.error(new ProgressEvent('error'));
    else r.flush({}, { status, statusText: 'Failed' });
    expect(view.state.configurations.form).toEqual(form);
    expect(view.state.configurations.busy()).toBe(false);
    expect(
      status === 422
        ? view.state.configurations.error()
        : view.state.configurations.uncertainties().join(),
    ).toContain(status === 422 ? 'Validación' : 'No se pudo confirmar');
    http.expectNone(`${base}/config/create`);
    http.expectNone(`${base}/config`);
  });
  it('blocks invalid JSON before dispatch', () => {
    const view = enter().componentInstance;
    view.state.configurations.form.schedule = { mode: 'value', value: '{' };
    view.state.configurations.create();
    http.expectNone(`${base}/config/create`);
    expect(view.state.configurations.error()).toContain('JSON');
    expect(view.state.configurations.busy()).toBe(false);
  });
  it.each(['run', 'delete'] as const)(
    'freezes %s confirmation, cancels without dispatch and consumes it once',
    (action) => {
      const fixture = enter(),
        view = fixture.componentInstance,
        copy = structuredClone(job);
      view.state.configurations.prepare(action, copy);
      view.state.configurations.refresh();
      view.state.configurations.create();
      http.expectNone(`${base}/config`);
      http.expectNone(`${base}/config/create`);
      copy.id = 'changed';
      expect(view.state.configurations.pending()?.id).toBe(job.id);
      expect(Object.isFrozen(view.state.configurations.pending())).toBe(true);
      view.state.configurations.cancel();
      view.state.configurations.confirm();
      http.expectNone(`${base}/${action === 'run' ? 'run' : 'config/delete'}`);
      view.state.configurations.prepare(action, job);
      view.state.configurations.confirm();
      view.state.configurations.confirm();
      const r = http.expectOne(`${base}/${action === 'run' ? 'run' : 'config/delete'}`);
      expect(r.request.body).toEqual({ id: job.id });
      r.flush(action === 'run' ? { state: 'QUEUED', execution_id: 'execution' } : job);
      http.expectOne(`${base}/config`).flush({ backups: action === 'delete' ? [] : [job] });
      expect(view.state.configurations.resultLabel()).toContain(
        action === 'run' ? 'no confirma inicio ni finalización' : 'archivos se conservan',
      );
    },
  );
  it('preserves uncertain admission across successful refreshes and later writes', () => {
    const view = enter().componentInstance;
    view.state.configurations.prepare('run', job);
    view.state.configurations.confirm();
    http.expectOne(`${base}/run`).flush({}, { status: 504, statusText: 'Timeout' });
    const warning = view.state.configurations.uncertainties()[0];
    expect(warning).toContain(job.id);
    view.state.configurations.refresh();
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(view.state.configurations.uncertainties()).toEqual([warning]);
    view.state.configurations.prepare('run', job);
    view.state.configurations.confirm();
    http.expectOne(`${base}/run`).flush({ state: 'FUTURE', execution_id: 'future' });
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(view.state.configurations.resultLabel()).toContain('FUTURE');
    expect(view.state.configurations.uncertainties()).toEqual([warning]);
  });
  it('fails closed if the confirmation cannot open', () => {
    const view = enter().componentInstance;
    dialogs.open.mockImplementationOnce(() => {
      throw new Error();
    });
    view.state.configurations.prepare('delete', job);
    view.state.configurations.confirm();
    expect(view.state.configurations.pending()).toBeNull();
    expect(view.state.configurations.busy()).toBe(false);
    expect(view.state.configurations.error()).toContain('confirmación');
    http.expectNone(`${base}/config/delete`);
  });
  it('clears selection, data, form and dialogs on leave or session change', () => {
    const view = enter().componentInstance;
    view.state.configurations.select(job.id);
    view.state.configurations.prepare('run', job);
    view.ionViewWillLeave();
    view.state.configurations.confirm();
    expect(view.state.configurations.entries()).toBeNull();
    expect(view.state.configurations.form).toEqual(emptyForm());
    expect(view.state.configurations.selectedId()).toBeNull();
    expect(view.state.configurations.pending()).toBeNull();
    http.expectNone(`${base}/run`);
    enterPage(view);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    view.state.configurations.prepare('delete', job);
    TestBed.inject(ThemeIdentity).clear();
    view.state.configurations.confirm();
    view.state.configurations.refresh();
    expect(view.state.configurations.entries()).toBeNull();
    expect(view.state.configurations.pending()).toBeNull();
    http.expectNone(`${base}/config/delete`);
    http.expectNone(`${base}/config`);
  });

  it('focuses Cancel after rendering the shared dialog and restores the trigger on cancel', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('.backup-list button') as HTMLButtonElement;
    trigger.focus();
    view.state.configurations.prepare('run', job);
    TestBed.tick();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancelar');
    view.state.configurations.cancel();
    TestBed.tick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
    http.expectNone(`${base}/run`);
  });
  it('restores the enabled submit button after a direct state creation and post-create refresh', async () => {
    const fixture = enter(),
      view = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    openCreate(fixture);
    const trigger = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    trigger.focus();
    view.state.configurations.create();
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
    view.state.configurations.prepare('delete', job);
    view.state.configurations.confirm();
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
    openCreate(fixture);
    await fixture.whenStable();
    const name = fixture.nativeElement.querySelector('#backup-name') as HTMLInputElement;
    name.value = ' cached form ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.state.configurations.form.name).toBe(' cached form ');
    expect(name.value).toBe(' cached form ');
    fixture.changeDetectorRef.detach();
    TestBed.inject(ThemeIdentity).clear();
    await fixture.whenStable();
    expect(fixture.componentInstance.state.configurations.entries()).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.backup-list li').length).toBe(0);
    expect(fixture.nativeElement.querySelector('#backup-name')).toBeNull();
    enterPage(fixture.componentInstance);
    http.expectOne(`${base}/config`).flush({ backups: [] });
    fixture.changeDetectorRef.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#backup-name')).toBeNull();
    openCreate(fixture);
    fixture.changeDetectorRef.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#backup-name').value).toBe('');
  });
  it('cancels a tab confirmation without clearing drafts, results or search', () => {
    const fixture = enter();
    const page = fixture.componentInstance;
    const configurations = page.state.configurations;
    configurations.select(job.id);
    configurations.resultLabel.set('previous result');
    configurations.uncertainties.set(['previous uncertainty']);
    page.state.search.set('local search');
    configurations.prepare('run', job);
    const context = dialogs.config!.context;
    page.state.leaveTab();
    expect(dialogs.element).toBeNull();
    expect(configurations.pending()).toBeNull();
    expect(configurations.busy()).toBe(false);
    expect(configurations.selectedId()).toBeNull();
    expect(configurations.form).toEqual(validForm());
    expect(configurations.entries()).toEqual([job]);
    expect(configurations.resultLabel()).toBe('previous result');
    expect(configurations.uncertainties()).toEqual(['previous uncertainty']);
    expect(page.state.search()).toBe('local search');
    TestBed.inject(ArcaActionsService).dispatchAction('BACKUP_DIALOG_CLOSE', {
      option: 'confirm',
      data: { context },
    });
    configurations.confirm();
    http.expectNone(`${base}/run`);
  });
  it('keeps a configuration creation in flight across tabs without reselecting or stealing focus', async () => {
    const fixture = enter();
    const page = fixture.componentInstance;
    const configurations = page.state.configurations;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    openCreate(fixture);
    const trigger = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    trigger.focus();
    configurations.create();
    const request = http.expectOne(`${base}/config/create`);
    page.state.leaveTab();
    document.body.tabIndex = -1;
    document.body.focus();
    expect(configurations.busy()).toBe(true);
    request.flush(job);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    await fixture.whenStable();
    expect(configurations.result()).toEqual(job);
    expect(configurations.selectedId()).toBeNull();
    expect(configurations.form).toEqual(emptyForm());
    expect(document.activeElement).toBe(document.body);
    document.body.removeAttribute('tabindex');
  });
  it.each(['configurations', 'health', 'reports'] as const)(
    'drains old %s list responses before loading a fresh module session',
    (section) => {
      const page = enter().componentInstance;
      const state = page.state[section];
      const path =
        section === 'configurations'
          ? '/config'
          : section === 'health'
            ? '/health'
            : '/health/reports';
      state.refresh();
      const old = http.expectOne(`${base}${path}`);
      page.ionViewWillLeave();
      page.ionViewWillEnter();
      for (const other of ['/config', '/health', '/health/reports'].filter(
        (value) => value !== path,
      )) {
        http.expectOne(`${base}${other}`).flush(other === '/config' ? { backups: [] } : []);
      }
      http.expectNone(`${base}${path}`);
      old.flush(section === 'configurations' ? { backups: [job] } : []);
      expect(state.entries()).toBeNull();
      http.expectOne(`${base}${path}`).flush(section === 'configurations' ? { backups: [] } : []);
      expect(state.entries()).toEqual([]);
    },
  );
  it('does not restore configuration focus after leaving during the post-write refresh', async () => {
    const fixture = enter();
    const page = fixture.componentInstance;
    const configurations = page.state.configurations;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    openCreate(fixture);
    const trigger = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    trigger.focus();
    configurations.create();
    http.expectOne(`${base}/config/create`).flush(job);
    const refresh = http.expectOne(`${base}/config`);
    page.state.leaveTab();
    document.body.tabIndex = -1;
    document.body.focus();
    refresh.flush({ backups: [job] });
    TestBed.tick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(document.body);
    expect(configurations.result()).toEqual(job);
    expect(configurations.selectedId()).toBeNull();
    document.body.removeAttribute('tabindex');
  });
});
