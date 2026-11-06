import { formatCoreFailure } from '../../../services/core-failure';

export function limitedPrecision(value: unknown): boolean {
  if (typeof value === 'number')
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  if (Array.isArray(value)) return value.some(limitedPrecision);
  return value !== null && typeof value === 'object' && Object.values(value).some(limitedPrecision);
}

export function healthDate(value: string | null): string {
  if (value === null) return 'null';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('es-ES');
}

export function backupFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar el resultado. No se reenviará automáticamente. Actualizar configuraciones no confirma si el backup fue admitido.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}

export function healthFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar la creación de Health. No se reenviará automáticamente. Actualizar el historial no resuelve esta incertidumbre.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}

export function reportFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar la eliminación del informe. No se reenviará automáticamente. Actualizar los informes no resuelve esta incertidumbre.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}
