import { formatDate } from '@angular/common';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouteReuseStrategy } from '@angular/router';
import { MenuController as ArcaMenuController } from '@ionic/angular';
import { IonicRouteStrategy, MenuController } from '@ionic/angular/standalone';
import { ACTIONS_CONFIG, GLOBAL_CONFIG, LANG_CONFIG, MENU_CONFIG, TokenService } from 'arca';
import { environment } from '../environments/environment';
import { App } from './app';
import { appConfig } from './app.config';
import { appActions } from './arca-config/app.actions';
import { appGlobalConfig } from './arca-config/app.global.config';
import { langConfig } from './arca-config/app.literals';
import { appMenu } from './arca-config/app.menu.config';
import { HealthService } from './services/health.service';

describe('ARCA application configuration', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.inject(TokenService).clearAll();
  });

  it('preserves ARCA, Ionic and Spanish configuration', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('arca-core ion-router-outlet')).toBeTruthy();
    expect(TestBed.inject(GLOBAL_CONFIG)).toBe(appGlobalConfig);
    expect(TestBed.inject(MENU_CONFIG)).toBe(appMenu);
    expect(TestBed.inject(LANG_CONFIG)).toBe(langConfig);
    expect(TestBed.inject(ACTIONS_CONFIG)).toBe(appActions);
    expect(TestBed.inject(RouteReuseStrategy)).toBeInstanceOf(IonicRouteStrategy);
    expect(TestBed.inject(ArcaMenuController)).toBe(TestBed.inject(MenuController));
    expect(TestBed.inject(LOCALE_ID)).toBe('es');
    expect(formatDate(new Date(2026, 0, 1), 'MMMM', 'es')).toBe('enero');
  });

  it('uses cookies and ignores legacy ARCA bearer tokens', () => {
    TestBed.inject(TokenService).set('legacy-token');
    TestBed.inject(HealthService).getHealth().subscribe();
    const request = http.expectOne(`${environment.apiBaseUrl}/health`);
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ status: 'OK' });
  });
});
