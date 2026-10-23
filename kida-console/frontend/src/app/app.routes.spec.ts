import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ArcaService, MenuPosition } from 'arca';
import { of } from 'rxjs';
import { routes } from './app.routes';
import { appMenu } from './arca-config/app.menu.config';
import { AuthService } from './auth/auth.service';
import { Administrators } from './pages/administrators/administrators';
import { Backups } from './pages/backups/backups';
import { Dashboard } from './pages/dashboard/dashboard';
import { Docker } from './pages/docker/docker';
import { Login } from './pages/login/login';
import { Scheduler } from './pages/scheduler/scheduler';
import { Settings } from './pages/settings/settings';
import { System } from './pages/system/system';

const pages = [
  { path: '/dashboard', title: 'Dashboard', component: Dashboard },
  { path: '/system', title: 'System', component: System },
  { path: '/docker', title: 'Docker', component: Docker },
  { path: '/backups', title: 'Backups', component: Backups },
  { path: '/scheduler', title: 'Scheduler', component: Scheduler },
  { path: '/settings', title: 'Settings', component: Settings },
  { path: '/administrators', title: 'Administradores', component: Administrators },
];

describe('Console navigation', () => {
  let auth: { restore: ReturnType<typeof vi.fn>; accounts: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {
      restore: vi.fn(() => of(true)),
      accounts: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: ArcaService, useValue: { panels: {} } },
        { provide: AuthService, useValue: { ...auth, user: signal({ id: 1, username: 'admin' }) } },
      ],
    });
  });

  it.each(pages)('loads the protected page at $path', async ({ path, component }) => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(path);
    expect(page).toBeInstanceOf(component);
    expect(TestBed.inject(Router).url).toBe(path);
    expect(auth.restore).toHaveBeenCalledOnce();
    if (component !== Administrators) {
      expect(harness.routeNativeElement?.textContent).toBe('');
      expect(auth.accounts).not.toHaveBeenCalled();
    }
  });

  it.each(pages)('rejects access without a session at $path', async ({ path }) => {
    auth.restore.mockReturnValue(of(false));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(path, Login);
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(auth.accounts).not.toHaveBeenCalled();
  });

  it.each(['/', '/unknown', '/unknown/nested'])('redirects %s to Dashboard', async (path) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(path, Dashboard);
    expect(TestBed.inject(Router).url).toBe('/dashboard');
    expect(auth.restore).toHaveBeenCalledOnce();
  });

  it.each(['/', '/unknown'])('protects the Dashboard redirect from %s', async (path) => {
    auth.restore.mockReturnValue(of(false));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(path, Login);
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('keeps login public', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login', Login);
    expect(auth.restore).not.toHaveBeenCalled();
  });

  it('connects the seven ARCA entries to their pages with unique IDs', () => {
    expect(appMenu.fixedPosition).toBe(MenuPosition.left);
    expect(appMenu.floatingPosition).toBe(MenuPosition.left);
    expect(appMenu.items.map(({ title, path }) => ({ title, path }))).toEqual(
      pages.map(({ title, path }) => ({ title, path })),
    );
    expect(appMenu.items.every((item) => Boolean(item.id))).toBe(true);
    expect(new Set(appMenu.items.map((item) => item.id)).size).toBe(7);
  });
});
