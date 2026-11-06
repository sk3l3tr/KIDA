import { Routes } from '@angular/router';

export const backupsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./backups').then((m) => m.Backups),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'configurations' },
      {
        path: 'configurations',
        loadComponent: () =>
          import('./tabs/backup-configurations/backup-configurations').then(
            (m) => m.BackupConfigurations,
          ),
      },
      {
        path: 'health',
        loadComponent: () => import('./tabs/backup-health/health').then((m) => m.BackupHealth),
      },
      {
        path: 'reports',
        loadComponent: () => import('./tabs/backup-reports/reports').then((m) => m.BackupReports),
      },
    ],
  },
];
