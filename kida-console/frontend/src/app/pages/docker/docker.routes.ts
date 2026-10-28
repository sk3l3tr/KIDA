import { Routes } from '@angular/router';

export const dockerRoutes: Routes = [{
  path: '',
  loadComponent: () => import('./docker').then((m) => m.Docker),
  children: [
    { path: '', pathMatch: 'full', redirectTo: 'projects' },
    { path: 'projects', data: { tab: 'projects' }, loadComponent: () => import('./docker-view').then((m) => m.DockerView) },
    { path: 'containers', data: { tab: 'containers' }, loadComponent: () => import('./docker-view').then((m) => m.DockerView) },
  ],
}];
