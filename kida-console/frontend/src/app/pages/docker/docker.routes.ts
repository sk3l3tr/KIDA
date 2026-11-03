import { Routes } from '@angular/router';

export const dockerRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./docker').then((m) => m.Docker),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'projects' },
      {
        path: 'projects',
        loadComponent: () =>
          import('./tabs/docker-projects/docker-projects').then((m) => m.DockerProjects),
      },
      {
        path: 'containers',
        loadComponent: () =>
          import('./tabs/docker-containers/docker-containers').then((m) => m.DockerContainers),
      },
    ],
  },
];
