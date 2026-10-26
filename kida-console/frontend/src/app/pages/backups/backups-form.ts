import { BackupForm, CommandForm, CreateBackup, OptionalField } from './backups.models';

export function optionalField(): OptionalField {
  return { mode: 'omit', value: '' };
}
export function newTarget() {
  return { path: '', required: true, filesystem_uuid: optionalField() };
}
export function newCommand(): CommandForm {
  return { command: '', params: optionalField() };
}
export function emptyForm(): BackupForm {
  return {
    name: '',
    sources: [{ path: '' }],
    targets: [newTarget()],
    lifecycleEnabled: false,
    pre_backup: [],
    post_backup: [],
    schedule: optionalField(),
    retention: 'omit',
    max_age: optionalField(),
    keep_last: optionalField(),
    protected_restore_points: [],
  };
}
function validString(value: string): string {
  if (/\p{Surrogate}/u.test(value))
    throw new Error('No se permiten caracteres Unicode incompletos.');
  return value;
}
/** Reject lossy JSON input before serializing it through JavaScript's number type. */
export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value, (key, item: unknown) => {
      validString(key);
      if (typeof item === 'string') validString(item);
      if (
        typeof item === 'number' &&
        (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))
      )
        throw new Error();
      return item;
    });
  } catch {
    throw new Error(
      'Introduce JSON válido, sin caracteres incompletos, con números finitos y enteros seguros.',
    );
  }
}
function optional<T>(field: OptionalField, parse: (value: string) => T): T | null | undefined {
  switch (field.mode) {
    case 'omit':
      return undefined;
    case 'null':
      return null;
    case 'value':
      return parse(field.value);
    default:
      throw new Error('Selecciona una opción válida.');
  }
}
function uint32(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 4294967295)
    throw new Error('keep_last debe ser un entero entre 0 y 4294967295.');
  return Number(value);
}
export function createBody(form: BackupForm): CreateBackup {
  const body: CreateBackup = {
    name: validString(form.name),
    sources: form.sources.map((row) => validString(row.path)),
    targets: form.targets.map((row) => {
      const uuid = optional(row.filesystem_uuid, validString);
      if (typeof row.required !== 'boolean') throw new Error('required debe ser un booleano.');
      return {
        path: validString(row.path),
        required: row.required,
        ...(uuid === undefined ? {} : { filesystem_uuid: uuid }),
      };
    }),
    compression: 'tar_zstd',
  };
  if (form.lifecycleEnabled) {
    const commands = (rows: CommandForm[]) =>
      rows.map((row) => {
        const params = optional(row.params, parseJson);
        return { command: validString(row.command), ...(params === undefined ? {} : { params }) };
      });
    body.lifecycle = {
      pre_backup: commands(form.pre_backup),
      post_backup: commands(form.post_backup),
    };
  }
  const schedule = optional(form.schedule, parseJson);
  if (schedule !== undefined) body.schedule = schedule;
  switch (form.retention) {
    case 'omit':
      break;
    case 'null':
      body.retention = null;
      break;
    case 'value': {
      const maxAge = optional(form.max_age, validString);
      const keepLast = optional(form.keep_last, uint32);
      body.retention = {
        ...(maxAge === undefined ? {} : { max_age: maxAge }),
        ...(keepLast === undefined ? {} : { keep_last: keepLast }),
        protected_restore_points: form.protected_restore_points.map((row) => validString(row.path)),
      };
      break;
    }
    default:
      throw new Error('Selecciona una retención válida.');
  }
  return body;
}
