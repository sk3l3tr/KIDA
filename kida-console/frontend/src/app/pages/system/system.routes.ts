import { Routes } from '@angular/router';

export const systemRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./system').then((m) => m.System),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        loadComponent: () =>
          import('./components/system-overview/system-overview').then((m) => m.SystemOverview),
      },
      {
        path: 'energy',
        loadComponent: () =>
          import('./components/system-energy/system-energy').then((m) => m.SystemEnergy),
      },
      {
        path: 'sensors',
        loadComponent: () =>
          import('./components/system-inspector/system-inspector').then((m) => m.SystemInspector),
      },
    ],
  },
];
