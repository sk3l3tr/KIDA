import { formatCoreFailure } from '../../services/core-failure';
import { ContainerAction } from './docker.models';

export const actionLabels: Record<ContainerAction, string> = {
  start: 'Arrancar',
  stop: 'Parar',
  restart: 'Reiniciar',
  delete: 'Eliminar',
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
    uncertain: 'No se pudo confirmar el resultado. No se reenviará automáticamente. Actualiza contenedores antes de realizar otra acción.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}
