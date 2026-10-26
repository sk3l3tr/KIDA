import { classifyCoreFailure } from '../../services/core-failure';

// CORE may extend these objects. Keep unknown fields for presentation.
export interface CoreFields {
  [key: string]: unknown;
}
export interface SystemInfo extends CoreFields {
  hostname: string | null;
  os: CoreFields;
  kernel: CoreFields;
  architecture: string;
  hardware: CoreFields;
  cpu: CoreFields;
  memory: { total_bytes: number; available_bytes: number; used_bytes: number } & CoreFields;
  graphics: string[];
  disks: CoreFields[];
}
export interface SystemHealth extends CoreFields {
  overall: string;
  sensors: CoreFields[];
}
export interface WakeCapabilities extends CoreFields {
  rtc_device: string | null;
  rtcwake_available: boolean | null;
  rtc_alarm_available: boolean | null;
  s5_wake_status: string;
  warnings: string[];
}
export interface PowerResult extends CoreFields {
  scheduled: boolean;
  when: string;
}
export interface CycleResult extends CoreFields {
  shutdown_at?: string | null;
  wake_at: string;
  shutdown_scheduled: boolean;
  s5_wake_status: string;
}
export type PowerCycleRequest = (
  | { wake_time: string; wake_after_seconds?: never }
  | { wake_after_seconds: number; wake_time?: never }
) & { shutdown_time?: string };
export type PowerAction = 'shutdown' | 'reboot' | 'powerCycle';
export type PendingAction =
  | { action: 'shutdown' | 'reboot'; body: Readonly<{ when: string }> }
  | { action: 'powerCycle'; body: Readonly<PowerCycleRequest> };
export const actionLabels: Record<PowerAction, string> = {
  shutdown: 'Apagar',
  reboot: 'Reiniciar',
  powerCycle: 'Ciclo de energía',
};

export function validWhen(value: string): boolean {
  return /^(now|\+[0-9]+|(?:[01]?[0-9]|2[0-3]):[0-5]?[0-9])$/.test(value);
}
export function validClock(value: string): boolean {
  return /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}
export function cycleRequest(
  mode: string,
  wake: string,
  seconds: string,
  shutdown: string,
): PowerCycleRequest | null {
  if (shutdown && !validClock(shutdown)) return null;
  const optional = shutdown ? { shutdown_time: shutdown } : {};
  if (mode === 'time' && validClock(wake)) return { wake_time: wake, ...optional };
  if (mode === 'seconds' && /^[0-9]+$/.test(seconds)) {
    const value = Number(seconds);
    if (Number.isSafeInteger(value) && value >= 120)
      return { wake_after_seconds: value, ...optional };
  }
  return null;
}

export function systemFailure(failure: unknown, action = false): string {
  const { kind, message } = classifyCoreFailure(failure, action);
  switch (kind) {
    case 'busy':
      return message;
    case 'uncertain':
      return 'Ejecución incierta: no se pudo confirmar el resultado. Comprueba el estado del equipo antes de enviar otra acción.';
    case 'unavailable':
      return 'Sin conexión con el servidor o CORE.';
    case 'expired':
      return 'La sesión ha caducado.';
    case 'validation':
      return 'Datos rechazados por el servidor. Revisa los parámetros y la hora local de CORE.';
    default:
      return message === undefined ? 'No se pudo completar la operación.' : `Error: ${message}`;
  }
}
