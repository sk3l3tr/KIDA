import { systemLabel } from '../../system/utils/system-format';

export interface EquipmentGroup {
  key: string;
  title: string;
  value: unknown;
  expandable: boolean;
}

export function systemFields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function equipmentGroup(
  key: string,
  value: unknown,
  title = systemLabel(key),
): EquipmentGroup {
  // A single scalar (for example one GPU) is readable without a disclosure.
  if (Array.isArray(value) && value.length === 1 && !isStructured(value[0])) {
    value = value[0];
  }
  return { key, title, value, expandable: isStructured(value) };
}

function isStructured(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (!Array.isArray(value) || value.length > 0);
}

export function equipmentGroups(value: unknown, detail: 'system' | 'hardware'): EquipmentGroup[] {
  const fields = systemFields(value);
  const keys =
    detail === 'system'
      ? ['os', 'kernel', 'architecture']
      : ['hardware', 'cpu', 'memory', 'graphics', 'disks'];
  return keys
    .map((key) =>
      equipmentGroup(key, fields[key], key === 'hardware' ? 'Equipo' : systemLabel(key)),
    )
    .sort((a, b) => Number(a.expandable) - Number(b.expandable));
}
