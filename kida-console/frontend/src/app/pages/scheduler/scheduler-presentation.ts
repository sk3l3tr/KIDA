import { formatCoreFailure } from '../../services/core-failure';
import { OriginFilter, ScheduleRule } from './scheduler.models';

export const originLabels: Record<OriginFilter, string> = {
  USER: 'Usuario',
  INTERNAL: 'Interno',
  ALL: 'Todos',
};

export function localDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return `Fecha desconocida: ${value}`;
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.toLocaleString('es-ES')} (UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`;
}
export function ruleSummary(rule: ScheduleRule): string {
  switch (rule.type) {
    case 'once': {
      const date = new Date(rule.at);
      const utc = Number.isFinite(date.getTime()) ? date.toISOString() : 'Desconocido';
      return `Puntual: ${localDate(rule.at)} · UTC: ${utc}`;
    }
    case 'interval':
      return `Intervalo: cada ${rule.seconds} segundos`;
    case 'cron':
      return `Cron: ${rule.expression} · ${rule.timezone}`;
    default:
      return 'Regla desconocida; consulta los detalles.';
  }
}

export function schedulerFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain: 'No se pudo confirmar el resultado. Actualiza el listado antes de repetir',
    validation: 'Validación HTTP: datos rechazados por el servidor. Revisa el formulario.',
    rejected: 'core',
  });
}
