import { THEME_STORAGE, ThemeService } from '../../lib/theming/theme.service';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { environment } from '../../environments/environment';
import { appConfig } from '../app.config';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { Administrators } from '../pages/administrators/administrators';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { Login } from '../pages/login/login';

const base = environment.apiBaseUrl;
const session = { user: { id: 1, username: 'admin' }, csrf_token: 'csrf-token' };
const arcaProviders = [
  ...appConfig.providers,
  {
    provide: ArcaService,
    useFactory: () => ({ actions: inject(ArcaActionsService), panels: inject(ArcaPanelsService) }),
  },
  {
    provide: ArcaPanelsService,
    useValue: {
      showLoader: vi.fn(),
      hideLoader: vi.fn(),
      hideHeader: vi.fn(),
      hideFooter: vi.fn(),
      showHeader: vi.fn(),
      showFooter: vi.fn(),
      hideFloatingMenu: vi.fn(),
      hideMenu: vi.fn(),
      showFloatingMenu: vi.fn(),
      showMenu: vi.fn(),
    },
  },
];

describe('Session authentication', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let router: Router;
  let themeValues: Map<string, string>;
  beforeEach(() => {
    themeValues = new Map();
    TestBed.configureTestingModule({
      providers: [
        ...arcaProviders,
        provideHttpClientTesting(),
        {
          provide: THEME_STORAGE,
          useValue: {
            getItem: (key: string) => themeValues.get(key) ?? null,
            setItem: (key: string, value: string) => {
              themeValues.set(key, value);
            },
          },
        },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });
  afterEach(() => http.verify());

  it('prepares CSRF, logs in and restores the session without local storage', () => {
    const complete = vi.fn();
    auth.login('admin', 'password').subscribe({ complete });
    const csrf = http.expectOne(`${base}/auth/csrf`);
    expect(csrf.request.withCredentials).toBe(true);
    http.expectNone(`${base}/auth/login`);
    csrf.flush({ csrf_token: 'prelogin-token' });
    const login = http.expectOne(`${base}/auth/login`);
    expect(login.request.headers.get('X-CSRF-Token')).toBe('prelogin-token');
    expect(login.request.body).toEqual({ username: 'admin', password: 'password' });
    login.flush(session);
    expect(auth.user()).toEqual(session.user);
    expect(auth.csrfToken()).toBe('csrf-token');
    expect(complete).toHaveBeenCalledOnce();
    auth.restore().subscribe((valid) => expect(valid).toBe(true));
    http.expectOne(`${base}/auth/session`).flush(session);
  });

  it('applies account appearance before session completion, keeps it on rename and logout', () => {
    themeValues.set(
      'kida:appearance:account:1',
      JSON.stringify({ version: 1, theme: 'sakura', mode: 'dark' }),
    );
    const themes = TestBed.inject(ThemeService);
    auth.restore().subscribe(() => {
      expect(themes.scope()).toBe('1');
      expect(themes.theme()).toBe('sakura');
      expect(themes.mode()).toBe('dark');
    });
    expect(themes.scope()).toBeNull();
    http.expectOne(`${base}/auth/session`).flush(session);
    auth.rename('renamed').subscribe();
    http.expectOne(`${base}/admins/me`).flush({ id: 1, username: 'renamed' });
    expect(themes.scope()).toBe('1');
    expect(themes.theme()).toBe('sakura');
    auth.logout().subscribe();
    http.expectOne(`${base}/auth/logout`).flush(null, { status: 204, statusText: 'No Content' });
    expect(themes.scope()).toBeNull();
    expect(themes.theme()).toBe('sakura');
    expect(themeValues.size).toBe(1); // restoration/rename/logout never write preferences
  });

  it('keeps an unconfirmed theme scope after a network error without declaring anonymity', () => {
    const themes = TestBed.inject(ThemeService);
    auth.restore().subscribe();
    http.expectOne(`${base}/auth/session`).flush(session);
    const failure = vi.fn();
    auth.restore().subscribe({ error: failure });
    themes.selectTheme('tokyo');
    http.expectOne(`${base}/auth/session`).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(auth.user()).toEqual(session.user);
    expect(failure).toHaveBeenCalledOnce();
    expect(themes.scope()).toBeNull();
    expect([...themeValues.keys()]).toEqual(['kida:appearance:global']);
  });

  it.each([401])(
    'discards an old session response (%s) after login to another account',
    (status) => {
      auth.restore().subscribe();
      const pending = http.expectOne(`${base}/auth/session`);
      auth.login('second', 'password').subscribe();
      http.expectOne(`${base}/auth/csrf`).flush({ csrf_token: 'second-csrf' });
      const second = { user: { id: 2, username: 'second' }, csrf_token: 'second-token' };
      http.expectOne(`${base}/auth/login`).flush(second);
      if (status === 200) pending.flush(session);
      else pending.flush({}, { status: 401, statusText: 'Unauthorized' });
      const themes = TestBed.inject(ThemeService);
      expect(auth.user()).toEqual(second.user);
      expect(auth.csrfToken()).toBe('second-token');
      expect(themes.scope()).toBe('2');
      themes.selectTheme('tokyo');
      expect([...themeValues.keys()].sort()).toEqual([
        'kida:appearance:account:2',
        'kida:appearance:global',
      ]);
    },
  );

  it('keeps unsaved account appearance through protected navigation', () => {
    auth.restore().subscribe();
    http.expectOne(`${base}/auth/session`).flush(session);
    vi.spyOn(TestBed.inject(THEME_STORAGE), 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const themes = TestBed.inject(ThemeService);
    themes.selectTheme('tokyo');
    auth.restore().subscribe();
    http.expectOne(`${base}/auth/session`).flush(session);
    expect(themes.theme()).toBe('tokyo');
    expect(themes.persistenceUnavailable()).toBe(true);
  });

  it('propagates CSRF errors without sending login credentials', () => {
    const error = vi.fn();
    auth.login('admin', 'password').subscribe({ error });
    http.expectOne(`${base}/auth/csrf`).flush({}, { status: 503, statusText: 'Unavailable' });
    http.expectNone(`${base}/auth/login`);
    expect(error.mock.calls[0][0].status).toBe(503);
    expect(auth.user()).toBeNull();
  });

  it('retries failed logins without replaying old actions or retaining credentials', () => {
    const error = vi.fn();
    auth.login('admin', 'wrong').subscribe({ error });
    http.expectOne(`${base}/auth/csrf`).flush({ csrf_token: 'first' });
    expect(TestBed.inject(ArcaActionsService).getDataSnapshot('LOGIN_REQUEST')).toBe('undefined');
    http.expectOne(`${base}/auth/login`).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(error.mock.calls[0][0].status).toBe(401);
    expect(auth.user()).toBeNull();

    const next = vi.fn();
    auth.login('admin', 'correct').subscribe(next);
    http.expectNone(`${base}/auth/login`);
    http.expectOne(`${base}/auth/csrf`).flush({ csrf_token: 'second' });
    const login = http.expectOne(`${base}/auth/login`);
    expect(login.request.headers.get('X-CSRF-Token')).toBe('second');
    expect(next).not.toHaveBeenCalled();
    login.flush(session);
    expect(next).toHaveBeenCalledExactlyOnceWith(session);
    expect(auth.user()).toEqual(session.user);
  });

  it('unsubscribes action listeners when the login consumer leaves', () => {
    const next = vi.fn();
    const subscription = auth.login('admin', 'password').subscribe(next);
    const csrf = http.expectOne(`${base}/auth/csrf`);
    subscription.unsubscribe();
    csrf.flush({ csrf_token: 'unused' });
    http.expectNone(`${base}/auth/login`);
    expect(next).not.toHaveBeenCalled();
    expect(auth.csrfToken()).toBe('');
  });

  it('protects writes and leaves unrelated URLs untouched', () => {
    auth.csrfToken.set('token');
    auth.rename('newname').subscribe();
    const request = http.expectOne(`${base}/admins/me`);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('token');
    request.flush({ id: 1, username: 'newname' });
    TestBed.inject(HttpClient).post('https://other.example/api', {}).subscribe();
    const other = http.expectOne('https://other.example/api');
    expect(other.request.withCredentials).toBe(false);
    expect(other.request.headers.has('X-CSRF-Token')).toBe(false);
    other.flush({});
  });

  it('lists current accounts on every request, including an empty list', () => {
    const first = vi.fn();
    auth.accounts().subscribe(first);
    const request = http.expectOne(`${base}/admins`);
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush([session.user]);
    expect(first).toHaveBeenCalledExactlyOnceWith([session.user]);

    const next = vi.fn();
    const complete = vi.fn();
    auth.accounts().subscribe({ next, complete });
    expect(next).not.toHaveBeenCalled();
    http.expectOne(`${base}/admins`).flush([]);
    expect(next).toHaveBeenCalledExactlyOnceWith([]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('creates and renames accounts without retaining credentials in ARCA', () => {
    auth.user.set(session.user);
    auth.csrfToken.set('token');
    const body = {
      username: 'second',
      password: 'new-password',
      admin_username: 'admin',
      admin_password: 'current-password',
    };
    const next = vi.fn();
    auth.create(body).subscribe(next);
    const create = http.expectOne(`${base}/admins`);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(body);
    expect(create.request.headers.get('X-CSRF-Token')).toBe('token');
    expect(TestBed.inject(ArcaActionsService).getDataSnapshot('CREATE_ACCOUNT_REQUEST')).toBe(
      'undefined',
    );
    const second = { id: 2, username: 'second' };
    create.flush(second, { status: 201, statusText: 'Created' });
    expect(next).toHaveBeenCalledExactlyOnceWith(second);
    expect(auth.user()).toEqual(session.user);

    auth.rename('renamed').subscribe();
    const rename = http.expectOne(`${base}/admins/me`);
    expect(rename.request.method).toBe('PATCH');
    expect(rename.request.body).toEqual({ username: 'renamed' });
    rename.flush({ id: 1, username: 'renamed' });
    expect(auth.user()).toEqual({ id: 1, username: 'renamed' });
  });

  it('preserves the session after a failed password change and completes a successful retry', () => {
    auth.user.set(session.user);
    auth.csrfToken.set('token');
    const error = vi.fn();
    auth.password('wrong', 'replacement-password').subscribe({ error });
    http
      .expectOne(`${base}/admins/me/password`)
      .flush({ detail: 'Credenciales incorrectas.' }, { status: 401, statusText: 'Unauthorized' });
    expect(error.mock.calls[0][0].status).toBe(401);
    expect(auth.user()).toEqual(session.user);
    expect(router.navigate).not.toHaveBeenCalled();

    const next = vi.fn();
    const complete = vi.fn();
    auth.password('current-password', 'replacement-password').subscribe({ next, complete });
    const request = http.expectOne(`${base}/admins/me/password`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      current_password: 'current-password',
      password: 'replacement-password',
    });
    expect(request.request.headers.get('X-CSRF-Token')).toBe('token');
    expect(TestBed.inject(ArcaActionsService).getDataSnapshot('CHANGE_PASSWORD_REQUEST')).toBe(
      'undefined',
    );
    expect(next).not.toHaveBeenCalled();
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(next).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(auth.user()).toBeNull();
  });

  it('resolves each deletion ID and preserves the session when deleting another account', () => {
    auth.user.set(session.user);
    auth.csrfToken.set('token');
    const error = vi.fn();
    auth.delete(2).subscribe({ error });
    http.expectOne(`${base}/admins/2`).flush({}, { status: 409, statusText: 'Conflict' });
    expect(error.mock.calls[0][0].status).toBe(409);
    expect(auth.user()).toEqual(session.user);

    for (const id of [3, 4]) {
      const complete = vi.fn();
      auth.delete(id).subscribe({ complete });
      const request = http.expectOne(`${base}/admins/${id}`);
      expect(request.request.method).toBe('DELETE');
      expect(request.request.headers.get('X-CSRF-Token')).toBe('token');
      expect(complete).not.toHaveBeenCalled();
      request.flush(null, { status: 204, statusText: 'No Content' });
      expect(complete).toHaveBeenCalledOnce();
      expect(auth.user()).toEqual(session.user);
    }
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('redirects after session expiry but retains a valid session on failed reauthentication', () => {
    auth.user.set(session.user);
    auth
      .create({
        username: 'other',
        password: 'new-password',
        admin_username: 'admin',
        admin_password: 'wrong',
      })
      .subscribe({ error: () => {} });
    http
      .expectOne(`${base}/admins`)
      .flush({ detail: 'Credenciales incorrectas.' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.user()).toEqual(session.user);
    auth.accounts().subscribe({ error: () => {} });
    http.expectOne(`${base}/admins`).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'expired' },
    });
  });

  it('redirects a revoked session even during reauthentication', () => {
    auth.user.set(session.user);
    auth.password('old', 'replacement-password').subscribe({ error: () => {} });
    http.expectOne(`${base}/admins/me/password`).flush(
      {},
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'X-Kida-Session-Expired': 'true' },
      },
    );
    expect(auth.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'expired' },
    });
  });

  it('clears local session after password change and self deletion', () => {
    auth.user.set(session.user);
    auth.password('old', 'new-password').subscribe();
    http
      .expectOne(`${base}/admins/me/password`)
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'password' },
    });
    auth.user.set(session.user);
    auth.delete(1).subscribe();
    http.expectOne(`${base}/admins/1`).flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'deleted' },
    });
  });

  it('revokes the current session with logout', () => {
    auth.user.set(session.user);
    auth.csrfToken.set('logout-token');
    const complete = vi.fn();
    auth.logout().subscribe({ complete });
    const request = http.expectOne(`${base}/auth/logout`);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('logout-token');
    expect(request.request.withCredentials).toBe(true);
    expect(auth.user()).toEqual(session.user);
    expect(auth.csrfToken()).toBe('logout-token');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.user()).toBeNull();
    expect(auth.csrfToken()).toBe('');
    expect(complete).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'expired' },
    });
  });

  it.each([0, 403, 503])('preserves the session when logout fails with status %s', (status) => {
    auth.user.set(session.user);
    auth.csrfToken.set('logout-token');
    const error = vi.fn();
    auth.logout().subscribe({ error });
    const request = http.expectOne(`${base}/auth/logout`);
    if (status === 0) request.error(new ProgressEvent('error'));
    else request.flush({}, { status, statusText: 'Logout failed' });
    expect(error.mock.calls[0][0].status).toBe(status);
    expect(auth.user()).toEqual(session.user);
    expect(auth.csrfToken()).toBe('logout-token');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('clears an already expired session when logout returns 401', () => {
    auth.user.set(session.user);
    auth.csrfToken.set('logout-token');
    const error = vi.fn();
    auth.logout().subscribe({ error });
    http
      .expectOne(`${base}/auth/logout`)
      .flush(
        {},
        { status: 401, statusText: 'Unauthorized', headers: { 'X-Kida-Session-Expired': 'true' } },
      );
    expect(error.mock.calls[0][0].status).toBe(401);
    expect(auth.user()).toBeNull();
    expect(auth.csrfToken()).toBe('');
    expect(router.navigate).toHaveBeenCalledOnce();
  });

  it('guard rejects an anonymous session and permits an authenticated session', () => {
    const invoke = () =>
      TestBed.runInInjectionContext(() =>
        authGuard({} as never, {} as never),
      ) as Observable<unknown>;
    invoke().subscribe((result) => expect(String(result)).toBe('/login'));
    http.expectOne(`${base}/auth/session`).flush({}, { status: 401, statusText: 'Unauthorized' });
    invoke().subscribe((result) => expect(result).toBe(true));
    http.expectOne(`${base}/auth/session`).flush(session);
  });

  it('does not disguise connection failures as anonymous sessions', () => {
    auth.restore().subscribe({ error: (error) => expect(error.status).toBe(503) });
    http.expectOne(`${base}/auth/session`).flush({}, { status: 503, statusText: 'Unavailable' });
  });
});

describe('Authentication views', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Login, Administrators, AppHeaderComponent],
      providers: [...arcaProviders, provideHttpClientTesting()],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('refreshes a cached view and last-account controls on each Ionic entry', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const second = { id: 2, username: 'second' };
    const accounts = vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user, second]));
    const fixture = TestBed.createComponent(Administrators);
    const view = fixture.componentInstance;
    view.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.accounts-list .danger').disabled).toBe(false);
    view.currentPassword = 'unfinished';
    view.newPassword = 'new-password';
    view.confirmPassword = 'new-password';
    view.createPassword = 'create-password';
    view.adminPassword = 'admin-password';
    view.pendingDelete.set(second);
    view.ionViewWillLeave();
    expect([
      view.currentPassword,
      view.newPassword,
      view.confirmPassword,
      view.createPassword,
      view.adminPassword,
    ]).toEqual(['', '', '', '', '']);
    expect(view.pendingDelete()).toBeNull();
    auth.user.set({ id: 1, username: 'renamed' });
    accounts.mockReturnValue(of([auth.user()!]));
    view.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.ownUsername).toBe('renamed');
    expect(accounts).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('.accounts-list .danger').disabled).toBe(true);
  });

  it('clears state on session changes and discards responses from the previous account', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const oldAccounts = new Subject<{ id: number; username: string }[]>();
    const second = { id: 2, username: 'second' };
    vi.spyOn(auth, 'accounts')
      .mockReturnValueOnce(oldAccounts)
      .mockReturnValue(of([second]));
    const fixture = TestBed.createComponent(Administrators);
    const view = fixture.componentInstance;
    view.ionViewWillEnter();
    fixture.detectChanges();
    view.currentPassword = 'old-secret';
    view.createUsername = 'unfinished';
    view.pendingDelete.set(session.user);
    auth.user.set(second);
    fixture.detectChanges();
    expect(view.ownUsername).toBe('second');
    expect(view.currentPassword).toBe('');
    expect(view.createUsername).toBe('');
    expect(view.pendingDelete()).toBeNull();
    oldAccounts.next([session.user]);
    expect(view.accounts()).toEqual([second]);
    auth.user.set(null);
    fixture.detectChanges();
    expect(view.ownUsername).toBe('');
    expect(view.accounts()).toEqual([]);
  });

  it('discards pending operation results when the administrators view leaves', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const creation = new Subject<{ id: number; username: string }>();
    vi.spyOn(auth, 'create').mockReturnValue(creation);
    const fixture = TestBed.createComponent(Administrators);
    const view = fixture.componentInstance;
    view.ionViewWillEnter();
    fixture.detectChanges();
    view.create();
    expect(view.busy()).toBe(true);
    view.ionViewWillLeave();
    creation.next({ id: 2, username: 'second' });
    expect(view.busy()).toBe(false);
    expect(view.message()).toBe('');
    expect(view.accounts()).toEqual([]);
    expect(auth.accounts).toHaveBeenCalledOnce();
  });

  it('shows a failed logout and lets the user retry before clearing the session', () => {
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    auth.user.set(session.user);
    auth.csrfToken.set('logout-token');
    const fixture = TestBed.createComponent(AppHeaderComponent);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    button.click();
    http.expectOne(`${base}/auth/logout`).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'No se ha podido completar la operación',
    );
    expect(auth.user()).toEqual(session.user);

    button.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    const retry = http.expectOne(`${base}/auth/logout`);
    expect(retry.request.headers.get('X-CSRF-Token')).toBe('logout-token');
    expect(auth.user()).toEqual(session.user);
    retry.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(auth.user()).toBeNull();
    expect(button.disabled).toBe(false);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledOnce();
  });

  it('hides ARCA panels on every login entry and resize, and restores them on exit', () => {
    const fixture = TestBed.createComponent(Login);
    const view = fixture.componentInstance;
    const panels = TestBed.inject(ArcaPanelsService);
    vi.clearAllMocks();
    fixture.detectChanges();
    view.ionViewWillEnter();
    expect(panels.hideHeader).toHaveBeenCalledTimes(1);
    expect(panels.hideFooter).toHaveBeenCalledTimes(1);
    expect(panels.hideMenu).toHaveBeenCalledTimes(1);
    expect(panels.hideFloatingMenu).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    expect(panels.hideHeader).toHaveBeenCalledTimes(2);
    expect(panels.hideFooter).toHaveBeenCalledTimes(2);
    expect(panels.showHeader).not.toHaveBeenCalled();
    expect(panels.showFooter).not.toHaveBeenCalled();
    view.ionViewWillLeave();
    expect(panels.showHeader).toHaveBeenCalledOnce();
    expect(panels.showFooter).toHaveBeenCalledOnce();
    expect(panels.showMenu).toHaveBeenCalledOnce();
    expect(panels.showFloatingMenu).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('resize'));
    expect(panels.hideHeader).toHaveBeenCalledTimes(2);
    view.ionViewWillEnter();
    expect(panels.hideHeader).toHaveBeenCalledTimes(3);
    expect(panels.hideFooter).toHaveBeenCalledTimes(3);
  });

  it('renders login without public registration and clears password on failure', async () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'login').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 429 })),
    );
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('input[autocomplete="current-password"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    fixture.componentInstance.username = 'admin';
    fixture.componentInstance.password = 'wrong';
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(fixture.componentInstance.password).toBe('');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Demasiados intentos',
    );
  });

  it('logs in and navigates to the protected page', () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'login').mockReturnValue(of(session));
    const fixture = TestBed.createComponent(Login);
    fixture.componentInstance.username = 'admin';
    fixture.componentInstance.password = 'password';
    fixture.componentInstance.submit();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/']);
    expect(fixture.componentInstance.password).toBe('');
  });

  it('lists administrators, disables last-account deletion and submits reauthentication', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const create = vi.spyOn(auth, 'create').mockReturnValue(of({ id: 2, username: 'second' }));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.accounts-list .danger').disabled).toBe(true);
    const view = fixture.componentInstance;
    view.createUsername = 'second';
    view.createPassword = 'password-two';
    view.adminUsername = 'admin';
    view.adminPassword = 'current-password';
    view.create();
    expect(create).toHaveBeenCalledWith({
      username: 'second',
      password: 'password-two',
      admin_username: 'admin',
      admin_password: 'current-password',
    });
    expect(view.adminPassword).toBe('');
    expect(view.createPassword).toBe('');
  });

  it('requires explicit confirmation before deleting an account', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const second = { id: 2, username: 'second' };
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user, second]));
    const remove = vi.spyOn(auth, 'delete').mockReturnValue(of(undefined));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    const buttons = fixture.nativeElement.querySelectorAll('.accounts-list .danger');
    buttons[1].click();
    fixture.detectChanges();
    expect(remove).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.confirmation').textContent).toContain('second');
    fixture.nativeElement.querySelector('.confirmation .danger').click();
    expect(remove).toHaveBeenCalledWith(2);
  });
});
