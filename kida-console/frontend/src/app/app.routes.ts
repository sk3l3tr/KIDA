import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((module) => module.Login),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard').then((module) => module.Dashboard),
  },
  {
    path: 'system',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/system/system').then((module) => module.System),
  },
  {
    path: 'docker',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/docker/docker').then((module) => module.Docker),
  },
  {
    path: 'backups',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/backups/backups').then((module) => module.Backups),
  },
  {
    path: 'scheduler',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/scheduler/scheduler').then((module) => module.Scheduler),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings').then((module) => module.Settings),
  },
  {
    path: 'administrators',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/administrators/administrators').then((module) => module.Administrators),
  },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
