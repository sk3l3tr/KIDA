import { formatCoreFailure } from '../../../services/core-failure';
import { ComposeProject, ContainerAction, DockerContainer } from './docker.models';

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

export function serviceKeys(project: ComposeProject): string[] {
  const occurrences = new Map<string | null, number>();
  return project.services.map((service) => {
    const occurrence = occurrences.get(service.name) ?? 0;
    occurrences.set(service.name, occurrence + 1);
    return JSON.stringify([service.name, occurrence]);
  });
}

export function filterContainers(
  containers: DockerContainer[],
  search: string,
  activity: 'all' | 'online' | 'offline',
  associations: Map<string, ComposeAssociation> | null,
): DockerContainer[] {
  const query = search.trim().toLowerCase();
  return containers.filter((container) => {
    if (activity === 'online' && !container.online) return false;
    if (activity === 'offline' && container.online) return false;
    if (!query) return true;
    const association = associations?.get(container.id);
    const fields = [container.name, container.id, container.image];
    if (association && association !== 'ambiguous') {
      fields.push(association.project);
      if (association.service !== null) fields.push(association.service);
    }
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

export function projectTotals(project: ComposeProject | null) {
  const containers = project?.services.flatMap((service) => service.containers) ?? [];
  return {
    services: project?.services.length ?? 0,
    containers: containers.length,
    online: containers.filter((container) => container.online).length,
  };
}
