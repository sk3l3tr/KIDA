import { formatDate } from '@angular/common';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouteReuseStrategy } from '@angular/router';
import { IonicRouteStrategy } from '@ionic/angular/standalone';
import {
  ACTIONS_CONFIG,
  ArcaInterceptor,
  GLOBAL_CONFIG,
  LANG_CONFIG,
  MENU_CONFIG,
  TokenService,
} from 'arca';
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
    TestBed.inject(TokenService).clearAll();
  });

  afterEach(() => {
    http.verify();
    TestBed.inject(TokenService).clearAll();
  });

  it('renders the application with ARCA and Ionic providers', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Hello, frontend');
    expect(TestBed.inject(GLOBAL_CONFIG)).toBe(appGlobalConfig);
    expect(TestBed.inject(MENU_CONFIG)).toBe(appMenu);
    expect(TestBed.inject(LANG_CONFIG)).toBe(langConfig);
    expect(TestBed.inject(ACTIONS_CONFIG)).toBe(appActions);
    expect(TestBed.inject(RouteReuseStrategy)).toBeInstanceOf(IonicRouteStrategy);
    expect(
      TestBed.inject(HTTP_INTERCEPTORS).some((value) => value instanceof ArcaInterceptor),
    ).toBe(true);
    expect(TestBed.inject(LOCALE_ID)).toBe('es');
    expect(formatDate(new Date(2026, 0, 1), 'MMMM', 'es')).toBe('enero');
  });

  it('passes health requests through ARCA and reuses the received token', () => {
    const service = TestBed.inject(HealthService);
    const healthUrl = `${environment.apiBaseUrl}${environment.endpoints.health}`;
    const received = vi.fn();

    service.getHealth().subscribe(received);
    const first = http.expectOne(healthUrl);
    expect(first.request.headers.has('Authorization')).toBe(false);
    first.flush({ status: 'OK', accessToken: 'test-token' });
    expect(received).toHaveBeenCalledExactlyOnceWith({ status: 'OK', accessToken: 'test-token' });

    service.getHealth().subscribe();
    const second = http.expectOne(healthUrl);
    expect(second.request.headers.get('Authorization')).toBe('Bearer test-token');
    second.flush({ status: 'OK' });
  });
});
