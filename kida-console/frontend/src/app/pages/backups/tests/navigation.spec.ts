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
import { BackupReports } from '../tabs/backup-reports/reports';

const base = `${environment.apiBaseUrl}/backup`;

describe('Backups child routes and shared session', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Backups],
      providers: [
        ...appConfig.providers,
        provideLocationMocks(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { restore: () => of(true), user: signal({ id: 1, username: 'admin' }) },
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
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Router).setUpLocationChangeListener();
  });
  afterEach(() => http.verify());

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
    expect(tab.nativeElement.querySelector('#health-definition').value).toBe('');
  });
});
