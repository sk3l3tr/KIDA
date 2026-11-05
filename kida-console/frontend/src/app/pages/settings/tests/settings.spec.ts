import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { Settings } from '../settings';
import { By } from '@angular/platform-browser';
import { ThemeService, THEME_STORAGE } from '../../../../lib/theming/theme.service';
import { SystemEquipment } from '../components/system-equipment/system-equipment';
import { SettingsAppearance } from '../components/settings-appearance/settings-appearance';

const url = `${environment.apiBaseUrl}/system/info`;
const info = {
  hostname: 'core-server',
  os: { name: 'Linux', version: null },
  graphics: [],
  future: { extra: 'visible' },
};

function setup(renderPage = false) {
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
  if (!renderPage) TestBed.overrideComponent(Settings, { set: { template: '', imports: [] } });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return TestBed.inject(HttpTestingController);
}

describe('Settings equipment lifecycle', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());

  function enter() {
    const fixture = TestBed.createComponent(Settings);
    fixture.componentInstance.ionViewWillEnter();
    return fixture;
  }

  it('loads only equipment on entry', () => {
    const view = enter().componentInstance.state;
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
    const view = enter().componentInstance.state;
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
    const view = enter().componentInstance.state;
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
    const view = enter().componentInstance.state;
    http.expectOne(url).flush(info);
    TestBed.inject(ThemeIdentity).clear();
    expect(view.info()).toBeNull();
    expect(view.loading()).toBe(false);
  });

  it('ignores old-session responses on identity changes', () => {
    const view = enter().componentInstance.state;
    const pending = http.expectOne(url);
    TestBed.inject(ThemeIdentity).clear();
    pending.flush({ ...info, hostname: 'old-session' });
    expect(view.info()).toBeNull();
    expect(view.loading()).toBe(false);
  });

  it('keeps appearance selection available independently of equipment loading', () => {
    const view = enter().componentInstance.state;
    const appearance = TestBed.createComponent(SettingsAppearance).componentInstance;
    appearance.themes.selectTheme('sakura');
    expect(appearance.themes.theme()).toBe('sakura');
    expect(appearance.selectedName()).toBe(
      appearance.catalog.find((theme) => theme.id === 'sakura')?.name,
    );
    expect(view.loading()).toBe(true);
    http.expectOne(url).flush(info);
    expect(appearance.themes.theme()).toBe('sakura');
  });
});

describe('Settings page integration', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup(true);
    const themes = TestBed.inject(ThemeService);
    themes.selectTheme('professional');
    themes.selectMode('light');
  });
  afterEach(() => http.verify());

  it('keeps Appearance before Equipment and allows theme and mode changes while loading', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const sections = root.querySelectorAll('app-settings-appearance, app-system-equipment');
    expect(Array.from(sections, (element) => element.tagName)).toEqual([
      'APP-SETTINGS-APPEARANCE',
      'APP-SYSTEM-EQUIPMENT',
    ]);
    expect(root.querySelectorAll('.theme-option')).toHaveLength(4);
    const themes = TestBed.inject(ThemeService);
    root.querySelector<HTMLButtonElement>('.theme-option:has([data-theme="sakura"])')!.click();
    fixture.detectChanges();
    expect(themes.theme()).toBe('sakura');
    expect(root.querySelector('[aria-pressed="true"]')?.textContent).toContain('Sakura');
    root.querySelector<HTMLInputElement>('input[value="dark"]')!.click();
    fixture.detectChanges();
    expect(themes.mode()).toBe('dark');
    expect(
      root.querySelector('.theme-preview[data-theme="sakura"]')?.getAttribute('data-mode'),
    ).toBe('dark');
    expect(fixture.componentInstance.state.loading()).toBe(true);
    root.querySelector<HTMLButtonElement>('.theme-option:has([data-theme="tokyo"])')!.click();
    fixture.detectChanges();
    expect(themes.theme()).toBe('tokyo');
    expect(themes.mode()).toBe('dark');
    expect(root.querySelector('.theme-modes')).toBeNull();
    http.expectOne(url).flush(info);
    fixture.detectChanges();
    const equipment = fixture.debugElement.query(By.directive(SystemEquipment))
      .componentInstance as SystemEquipment;
    expect(equipment.value()).toEqual(info);
    expect(equipment.loading()).toBe(false);
    expect(themes.theme()).toBe('tokyo');
  });

  it.each(['leave', 'identity', 'destroy'] as const)(
    'clears the equipment modal synchronously on %s',
    (transition) => {
      const fixture = TestBed.createComponent(Settings);
      fixture.componentInstance.ionViewWillEnter();
      http.expectOne(url).flush(info);
      fixture.detectChanges();
      const equipment = fixture.debugElement.query(By.directive(SystemEquipment))
        .componentInstance as SystemEquipment;
      // Do not render an open Ionic overlay in jsdom; exercise the page's synchronous cleanup.
      equipment.open('hardware');
      expect(equipment.isOpen()).toBe(true);
      const clear = vi.spyOn(equipment, 'clear');
      if (transition === 'leave') fixture.componentInstance.ionViewWillLeave();
      else if (transition === 'identity') TestBed.inject(ThemeIdentity).clear();
      else fixture.destroy();
      // No change detection between the transition and these assertions.
      expect(clear).toHaveBeenCalled();
      expect(equipment.isOpen()).toBe(false);
      expect(fixture.componentInstance.state.info()).toBeNull();
      expect(fixture.componentInstance.state.loading()).toBe(false);
    },
  );

  it('unsubscribes the local facade on destruction and ignores later identity changes', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.componentInstance.ionViewWillEnter();
    const request = http.expectOne(url);
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    fixture.destroy();
    const clear = vi.spyOn(state, 'clearEquipment');
    TestBed.inject(ThemeIdentity).clear();
    request.flush(info);
    expect(clear).not.toHaveBeenCalled();
    expect(state.info()).toBeNull();
    expect(state.loading()).toBe(false);
  });

  it('keeps the appearance persistence warning in the extracted component', () => {
    const storage = TestBed.inject(THEME_STORAGE);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.theme-option:has([data-theme="sakura"])').click();
    fixture.detectChanges();
    expect(TestBed.inject(ThemeService).theme()).toBe('sakura');
    expect(fixture.nativeElement.querySelector('[role="status"].error').textContent).toContain(
      'No se puede guardar la apariencia',
    );
    http.expectNone(url);
  });
});
