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
          import('./tabs/system-overview/system-overview').then((m) => m.SystemOverview),
      },
      {
        path: 'energy',
        loadComponent: () =>
          import('./tabs/system-energy/system-energy').then((m) => m.SystemEnergy),
      },
      {
        path: 'sensors',
        loadComponent: () =>
          import('./tabs/system-inspector/system-inspector').then((m) => m.SystemInspector),
      },
    ],
  },
];
