import { classifyCoreFailure } from '../../services/core-failure';
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
  const { kind, message } = classifyCoreFailure(failure, writing);
  switch (kind) {
    case 'busy':
      return message;
    case 'uncertain':
      return 'No se pudo confirmar el resultado. No se reenviará automáticamente. Actualiza contenedores antes de realizar otra acción.';
    case 'unavailable':
      return 'Sin conexión con el servidor o CORE.';
    case 'expired':
      return 'La sesión ha caducado.';
    case 'validation':
      return 'Validación HTTP: datos rechazados por el servidor.';
    case 'rejected':
      return `CORE rechazó la operación: ${message ?? 'sin detalles'}`;
    default:
      return message === undefined ? 'No se pudo completar la operación.' : `Error: ${message}`;
  }
}
