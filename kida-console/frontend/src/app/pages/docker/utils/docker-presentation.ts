import { formatCoreFailure } from '../../../services/core-failure';
import { ComposeProject, ContainerAction } from './docker.models';

export type ComposeAssociation = { project: string; service: string | null } | 'ambiguous';

export function composeAssociations(projects: ComposeProject[]): Map<string, ComposeAssociation> {
  const result = new Map<string, ComposeAssociation>();
  for (const project of projects) {
    for (const service of project.services) {
      for (const container of service.containers) {
        const existing = result.get(container.id);
        if (existing === 'ambiguous') continue;
        if (existing && (existing.project !== project.name || existing.service !== service.name)) {
          result.set(container.id, 'ambiguous');
        } else {
          result.set(container.id, { project: project.name, service: service.name });
        }
      }
    }
  }
  return result;
}

export const actionLabels: Record<ContainerAction, string> = {
  start: 'play',
  stop: 'stop',
  restart: 'restart',
  delete: 'trash',
};
export function display(value: unknown): string {
  return value === null || value === undefined ? 'Desconocido / no disponible' : String(value);
}
export function counter(value: number | null): string {
  return value === null
    ? display(value)
    : `${value}${Number.isSafeInteger(value) ? '' : ' (precisión limitada)'}`;
}
export function limitedPrecision(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.some(limitedPrecision);
  return value !== null && typeof value === 'object' && Object.values(value).some(limitedPrecision);
}
export function dockerFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar el resultado. No se reenviará automáticamente. Actualiza contenedores antes de realizar otra acción.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}
