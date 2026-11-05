import { CreateSchedule, JsonValue, ScheduleForm, ScheduleRule } from './scheduler.models';

export function emptyForm(): ScheduleForm {
  return {
    command: '',
    params: '{}',
    mode: 'once',
    local: '',
    seconds: '',
    expression: '',
    timezone: 'UTC',
  };
}

/** Date's compatible disambiguation picks the first occurrence of a repeated local time. */
export function localToUtc(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Introduce una fecha y hora local válida.');
  const [year, month, day, hour, minute, second] = match.slice(1).map((v) => Number(v ?? 0));
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, 0);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    throw new Error('La fecha local no existe o no es válida (comprueba el cambio horario).');
  }
  return date.toISOString();
}

export function createBody(form: ScheduleForm): CreateSchedule {
  if (!form.command.trim()) throw new Error('Introduce un comando.');
  let params: JsonValue;
  try {
    params = JSON.parse(form.params, (_key, value: unknown) => {
      if (
        typeof value === 'number' &&
        (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      )
        throw new Error();
      return value;
    }) as JsonValue;
  } catch {
    throw new Error('Parámetros: introduce JSON válido con números finitos y enteros seguros.');
  }
  let schedule: ScheduleRule;
  switch (form.mode) {
    case 'once':
      schedule = { type: 'once', at: localToUtc(form.local) };
      break;
    case 'interval': {
      const seconds = Number(form.seconds);
      if (!/^[0-9]+$/.test(form.seconds) || !Number.isSafeInteger(seconds) || seconds < 1)
        throw new Error('El intervalo debe ser un entero entre 1 y 9007199254740991 segundos.');
      schedule = { type: 'interval', seconds };
      break;
    }
    case 'cron':
      if (!form.expression.trim() || !form.timezone.trim())
        throw new Error('Introduce la expresión cron y la zona IANA.');
      schedule = { type: 'cron', expression: form.expression, timezone: form.timezone };
      break;
    default:
      throw new Error('Selecciona una modalidad válida.');
  }
  return { command: form.command, params, schedule };
}

export function freezeSnapshot<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item !== null && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy;
}
