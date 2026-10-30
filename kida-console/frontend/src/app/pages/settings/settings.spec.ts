import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { Settings } from './settings';

const url = `${environment.apiBaseUrl}/system/info`;
const info = {
  hostname: 'core-server',
  os: { name: 'Linux', version: null },
  graphics: [],
  future: { extra: 'visible' },
};

describe('Settings equipment lifecycle', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Settings],
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
    // Native overlay presentation and the complete layout are verified in Chromium.
    TestBed.overrideComponent(Settings, { set: { template: '', imports: [] } });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function enter() {
    const fixture = TestBed.createComponent(Settings);
    fixture.componentInstance.ionViewWillEnter();
    return fixture;
  }

  it('loads only equipment on entry', () => {
    const view = enter().componentInstance;
    expect(view.loading()).toBe(true);
    const request = http.expectOne(url);
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    http.expectNone(`${environment.apiBaseUrl}/system/health`);
    http.expectNone(`${environment.apiBaseUrl}/system/wake-capabilities`);
    request.flush(info);
    expect(view.info()).toEqual(info);
    expect(view.loading()).toBe(false);
  });

  it('handles a failed load and retries on the next entry', () => {
    const view = enter().componentInstance;
    http.expectOne(url).error(new ProgressEvent('error'));
    expect(view.info()).toBeNull();
    expect(view.loading()).toBe(false);
    http.expectNone(url);
    view.ionViewWillLeave();
    view.ionViewWillEnter();
    const fresh = { ...info, hostname: 'fresh-server' };
    http.expectOne(url).flush(fresh);
    expect(view.info()).toEqual(fresh);
    expect(view.loading()).toBe(false);
  });

  it('discards late results after leaving and reloads on entry', () => {
    const view = enter().componentInstance;
    const pending = http.expectOne(url);
    view.ionViewWillLeave();
    pending.flush(info);
    expect(view.info()).toBeNull();
    expect(view.loading()).toBe(false);
    http.expectNone(url);
    view.ionViewWillEnter();
    http.expectOne(url).flush(info);
    expect(view.info()).toEqual(info);
  });

  it('clears loaded equipment on identity changes', () => {
    const view = enter().componentInstance;
    http.expectOne(url).flush(info);
    TestBed.inject(ThemeIdentity).clear();
    expect(view.info()).toBeNull();
    expect(view.loading()).toBe(false);
  });

  it('ignores old-session responses on identity changes', () => {
    const view = enter().componentInstance;
    const pending = http.expectOne(url);
    TestBed.inject(ThemeIdentity).clear();
    pending.flush({ ...info, hostname: 'old-session' });
    expect(view.info()).toBeNull();
    expect(view.loading()).toBe(false);
  });

  it('keeps appearance selection available independently of equipment loading', () => {
    const view = enter().componentInstance;
    view.themes.selectTheme('sakura');
    expect(view.themes.theme()).toBe('sakura');
    expect(view.selectedName()).toBe(view.catalog.find((theme) => theme.id === 'sakura')?.name);
    expect(view.loading()).toBe(true);
    http.expectOne(url).flush(info);
    expect(view.themes.theme()).toBe('sakura');
  });
});
