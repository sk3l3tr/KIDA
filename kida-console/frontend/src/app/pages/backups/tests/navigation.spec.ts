import { signal, inject, ProviderToken, ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, of } from 'rxjs';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { AuthService } from '../../../auth/auth.service';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { Backups } from '../backups';
import { BackupsFacade } from '../services/backups.facade';
import { BackupConfigurationsState } from '../services/configurations-state';
import { BackupHealthState } from '../services/health-state';
import { BackupReportsState } from '../services/reports-state';
import { BackupConfigurations } from '../tabs/backup-configurations/backup-configurations';
import { BackupHealth } from '../tabs/backup-health/health';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { BackupReports } from '../tabs/backup-reports/reports';
import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { THEME_STORAGE, ThemeService } from '../../../../lib/theming/theme.service';
import { themeCatalog } from '../../../../theme/catalog';
import { BackupJob } from '../utils/backups.models';
import { HealthHistoryRecord } from '../utils/health.models';

const base = `${environment.apiBaseUrl}/backup`;

describe('Backups child routes and shared session', () => {
  let http: HttpTestingController;
  let dialogs: ReturnType<typeof mockArcaDialogs>;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Backups],
      providers: [
        ...appConfig.providers,
        provideLocationMocks(),
        provideHttpClientTesting(),
        { provide: THEME_STORAGE, useValue: { getItem: () => null, setItem: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            restore: () => of(true),
            user: signal({ id: 1, username: 'admin' }),
            csrfToken: signal('test-csrf'),
          },
        },
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
    // JSDOM does not run Ionic outlet transitions; Angular routes still resolve the real children.
    TestBed.overrideComponent(Backups, {
      set: { imports: [RouterOutlet], template: '<router-outlet />' },
    });
    TestBed.overrideComponent(SidePanel, {
      set: { template: '@if (open()) { <ng-content /><ng-content select="[panel-actions]" /> }' },
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Router).setUpLocationChangeListener();
    dialogs = mockArcaDialogs();
  });
  afterEach(() => {
    dialogs.dismiss();
    http.verify();
  });

  function initial() {
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(`${base}/health/reports`).flush([]);
  }
  function child(harness: RouterTestingHarness) {
    return harness.routeDebugElement!.query(
      (element) =>
        element.componentInstance instanceof BackupConfigurations ||
        element.componentInstance instanceof BackupHealth ||
        element.componentInstance instanceof BackupReports,
    );
  }

  it('completes a session across the three real tabs with confirmed writes and literal reports', async () => {
    const job: BackupJob = {
      id: 'config-ñ',
      name: ' daily ',
      sources: [' /srv/data '],
      targets: [{ path: ' /mnt/backup ', required: true }],
      compression: 'tar_zstd',
      lifecycle: { pre_backup: [], post_backup: [] },
    };
    const record: HealthHistoryRecord = {
      run_id: 'run-ñ',
      definition_path: ' /core/health.toml ',
      mode: 'MANUAL',
      state: 'CREATED',
      definition: {
        id: 'definition',
        name: 'Recovery',
        backup: { reference: job.name, version: 'latest' },
        docker: { compose: 'compose.yml' },
      },
      diagnosis: {
        result: 'UNKNOWN',
        summary: 'Not checked',
        complete: false,
        services: [],
        anomalies: [],
        evidence: [],
      },
      created_at: '2026-11-06T12:00:00Z',
      started_at: null,
      finished_at: null,
      artifact: null,
      compose_path: '/core/compose.yml',
      compose_checksum: null,
      restore_dir: '/tmp/restore',
      project: null,
      services: [],
      resources: [],
      cleanup: { state: 'PENDING', errors: [] },
      report_path: null,
      record_version: 1,
      restore_provenance: null,
      report_status: 'MISSING',
    };
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/backups', Backups);
    const configurations = child(harness).componentInstance as BackupConfigurations;
    configurations.ionViewWillEnter();
    initial();
    page.state.openConfigurationCreate();
    Object.assign(page.state.configurations.form, {
      name: job.name,
      sources: job.sources.map((path) => ({ path })),
    });
    page.state.configurations.form.targets[0].path = job.targets[0].path;
    harness.detectChanges();
    await harness.fixture.whenStable();
    child(harness)
      .nativeElement.querySelector('#backup-configuration-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(page.state.configurations.error()).toBe('');
    expect(page.state.configurations.busy()).toBe(true);
    const creation = http.expectOne(`${base}/config/create`);
    expect(creation.request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(creation.request.withCredentials).toBe(true);
    expect(creation.request.body).toEqual({
      name: job.name,
      sources: job.sources,
      targets: job.targets,
      compression: 'tar_zstd',
    });
    creation.flush(job);
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(page.state.panel()).toBeNull();
    page.state.configurations.prepare('run', job);
    dialogs.choose();
    const backup = http.expectOne(`${base}/run`);
    expect(backup.request.body).toEqual({ id: job.id });
    backup.flush({ state: 'QUEUED', execution_id: 'backup-queue' });
    http.expectOne(`${base}/config`).flush({ backups: [job] });
    expect(page.state.configurations.resultLabel()).toContain('no confirma inicio ni finalización');
    page.state.configurations.form.name = 'next draft';
    page.state.search.set('daily');
    configurations.ionViewWillLeave();
    await harness.navigateByUrl('/backups/health');
    const health = child(harness).componentInstance as BackupHealth;
    health.ionViewWillEnter();
    page.state.openHealthForm('health-create');
    health.state.definitionPath = record.definition_path;
    health.create();
    const healthCreation = http.expectOne(`${base}/health/create`);
    expect(healthCreation.request.body).toEqual({
      definition_path: record.definition_path,
      mode: 'MANUAL',
    });
    healthCreation.flush(record);
    http.expectOne(`${base}/health`).flush([record]);
    expect(page.state.panel()).toBeNull();
    http.expectNone(`${base}/health/start`);
    page.state.openHealthDetail(record.run_id);
    const detailUrl = `${base}/health/get?run_id=${encodeURIComponent(record.run_id)}`;
    http.expectOne(detailUrl).flush(record);
    health.prepare('start');
    expect(String(dialogs.config?.text)).toContain(record.run_id);
    dialogs.choose();
    const start = http.expectOne(`${base}/health/start`);
    expect(start.request.body).toEqual({ run_id: record.run_id });
    start.flush({ run_id: record.run_id, state: 'QUEUED', execution_id: 'health-queue' });
    http.expectOne(`${base}/health`).flush([{ ...record, state: 'STARTING' }]);
    http.expectOne(detailUrl).flush({ ...record, state: 'STARTING' });
    expect(health.state.queuedResult()?.execution_id).toBe('health-queue');
    health.ionViewWillLeave();
    await harness.navigateByUrl('/backups/reports');
    const reports = child(harness).componentInstance as BackupReports;
    reports.ionViewWillEnter();
    reports.state.refresh();
    http.expectOne(`${base}/health/reports`).flush([record.run_id]);
    page.state.openReportDetail(record.run_id);
    const markdown = '# Recovery\n  <script>literal</script>\n';
    http
      .expectOne(`${base}/health/reports/get?run_id=${encodeURIComponent(record.run_id)}`)
      .flush({ run_id: record.run_id, markdown });
    harness.detectChanges();
    expect(
      child(harness).nativeElement.querySelector('[data-testid="report-markdown"]').textContent,
    ).toBe(markdown);
    expect(child(harness).nativeElement.querySelector('script')).toBeNull();
    reports.prepare(record.run_id);
    dialogs.choose();
    const deletion = http.expectOne(`${base}/health/reports/delete`);
    expect(deletion.request.body).toEqual({ run_id: record.run_id });
    deletion.flush({ run_id: record.run_id, deleted: true });
    http.expectOne(`${base}/health`).flush([{ ...record, report_status: 'DELETED' }]);
    http.expectOne(`${base}/health/reports`).flush([]);
    harness.detectChanges();
    expect(page.state.panel()).toBeNull();
    expect(page.state.health.entries()?.[0].report_status).toBe('DELETED');
    expect(reports.state.resultLabel()).toBe('Informe eliminado');
    reports.ionViewWillLeave();
    await harness.navigateByUrl('/backups/configurations');
    child(harness).componentInstance.ionViewWillEnter();
    expect(page.state.configurations.form.name).toBe('next draft');
    expect(page.state.search()).toBe('daily');
    expect(page.state.configurations.resultLabel()).toContain('no confirma inicio ni finalización');
    expect(page.state.health.queuedResult()?.execution_id).toBe('health-queue');
    expect(page.state.reports.result()?.deleted).toBe(true);
    page.ionViewWillLeave();
    expect(page.state.configurations.form.name).toBe('');
    expect(page.state.search()).toBe('');
    expect(page.state.health.result()).toBeNull();
    expect(page.state.reports.result()).toBeNull();
  });

  it('preserves live pages, panel DOM, drafts and messages through all seven theme combinations', async () => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/backups', Backups);
    page.ionViewWillEnter();
    http.expectOne(`${base}/config`).flush({ backups: [] });
    http.expectOne(`${base}/health`).flush([]);
    http.expectOne(`${base}/health/reports`).flush(['report-ñ']);
    const themes = TestBed.inject(ThemeService);
    const identity = TestBed.inject(ThemeIdentity).snapshot();
    page.state.configurations.form.name = 'configuration draft';
    page.state.health.definitionPath = ' /core/draft ';
    page.state.search.set('saved query');
    page.state.health.uncertainties.set(['persistent uncertainty']);
    for (const tab of ['configurations', 'health', 'reports']) {
      page.state.leaveTab();
      await harness.navigateByUrl(`/backups/${tab}`);
      const view = child(harness);
      view.componentInstance.ionViewWillEnter();
      if (tab === 'configurations') page.state.openConfigurationCreate();
      else if (tab === 'health') page.state.openHealthForm('health-create');
      else {
        page.state.openReportDetail('report-ñ');
        http
          .expectOne(`${base}/health/reports/get?run_id=report-%C3%B1`)
          .flush({ run_id: 'report-ñ', markdown: '# Literal\n  <script>text</script>' });
      }
      harness.detectChanges();
      await harness.fixture.whenStable();
      const panel = page.state.panel();
      const content = view.nativeElement.querySelector(
        'app-side-panel input, [data-testid="report-markdown"]',
      );
      expect(content).not.toBeNull();
      let combinations = 0;
      for (const theme of themeCatalog) {
        themes.selectTheme(theme.id);
        for (const mode of theme.modes) {
          themes.selectMode(mode);
          harness.detectChanges();
          await harness.fixture.whenStable();
          expect(themes.mode()).toBe(mode);
          expect(document.documentElement.dataset['theme']).toBe(theme.id);
          expect(document.documentElement.dataset['mode']).toBe(mode);
          expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(
            mode === 'dark',
          );
          expect(child(harness).componentInstance).toBe(view.componentInstance);
          expect(page.state.panel()).toBe(panel);
          expect(
            view.nativeElement.querySelector(
              'app-side-panel input, [data-testid="report-markdown"]',
            ),
          ).toBe(content);
          expect(page.state.configurations.form.name).toBe('configuration draft');
          expect(page.state.health.definitionPath).toBe(' /core/draft ');
          expect(page.state.search()).toBe('saved query');
          expect(page.state.health.uncertainties()).toEqual(['persistent uncertainty']);
          expect(TestBed.inject(ThemeIdentity).snapshot()).toBe(identity);
          ++combinations;
        }
      }
      expect(combinations).toBe(7);
    }
    http.expectNone((request) => request.url.startsWith(base));
  });

  it('shares all providers, keeps drafts and loads only once while navigating and going back/forward', async () => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/backups', Backups);
    page.ionViewWillEnter();
    initial();
    const configurations = child(harness).componentInstance as BackupConfigurations;
    configurations.ionViewWillEnter();
    expect(TestBed.inject(Router).url).toBe('/backups/configurations');
    page.state.configurations.form.name = 'draft';
    page.state.search.set('query');
    page.state.health.definitionPath = ' /core/definition ';
    page.state.health.automaticPath = ' /core/automatic ';
    page.state.health.mode = 'AUTOMATIC';
    page.state.health.uncertainties.set(['uncertain']);
    page.state.reports.resultLabel.set('previous result');
    page.state.panel.set('configuration-create');
    configurations.ionViewWillLeave();
    await harness.navigateByUrl('/backups/health');
    const health = child(harness).componentInstance as BackupHealth;
    health.ionViewWillEnter();
    expect(health.backups).toBe(page.state);
    expect(health.state).toBe(page.state.health);
    health.ionViewWillLeave();
    await harness.navigateByUrl('/backups/reports');
    const reports = child(harness).componentInstance as BackupReports;
    reports.ionViewWillEnter();
    const providers: ProviderToken<unknown>[] = [
      BackupsFacade,
      BackupConfigurationsState,
      BackupHealthState,
      BackupReportsState,
    ];
    for (const provider of providers) {
      expect(child(harness).injector.get(provider)).toBe(
        harness.routeDebugElement!.injector.get(provider),
      );
    }
    expect(reports.state).toBe(page.state.reports);
    expect(page.state.panel()).toBeNull();
    expect(page.state.search()).toBe('query');
    expect(page.state.configurations.form.name).toBe('draft');
    expect(page.state.health.definitionPath).toBe(' /core/definition ');
    expect(page.state.health.automaticPath).toBe(' /core/automatic ');
    expect(page.state.health.mode).toBe('AUTOMATIC');
    expect(page.state.health.uncertainties()).toEqual(['uncertain']);
    expect(page.state.reports.resultLabel()).toBe('previous result');
    const router = TestBed.inject(Router);
    const back = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    TestBed.inject(Location).back();
    await back;
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/backups/health');
    expect(child(harness).componentInstance).toBeInstanceOf(BackupHealth);
    const forward = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    TestBed.inject(Location).forward();
    await forward;
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/backups/reports');
    expect(child(harness).componentInstance).toBeInstanceOf(BackupReports);
    http.expectNone((request) => request.url.startsWith(base));
  });

  it('cleans a detached child DOM on identity change and reactivates through the cached child hook', async () => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/backups/health', Backups);
    const tab = child(harness);
    const health = tab.componentInstance as BackupHealth;
    health.ionViewWillEnter();
    initial();
    page.state.health.definitionPath = 'private draft';
    page.state.openHealthForm('health-create');
    page.state.search.set('private search');
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(tab.nativeElement.querySelector('#health-definition').value).toBe('private draft');
    tab.injector.get(BackupHealthState).uncertainties.set(['private warning']);
    tab.injector.get(BackupsFacade).panel.set('health-create');
    harness.fixture.changeDetectorRef.detach();
    tab.injector.get(ChangeDetectorRef).detach();
    TestBed.inject(ThemeIdentity).clear();
    expect(page.state.active()).toBe(false);
    expect(page.state.search()).toBe('');
    expect(page.state.panel()).toBeNull();
    expect(page.state.health.uncertainties()).toEqual([]);
    expect(tab.nativeElement.querySelector('#health-definition')).toBeNull();
    health.ionViewWillEnter();
    initial();
    expect(page.state.active()).toBe(true);
    expect(tab.nativeElement.querySelector('#health-definition')).toBeNull();
    page.state.openHealthForm('health-create');
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(tab.nativeElement.querySelector('#health-definition').value).toBe('');
  });
});
