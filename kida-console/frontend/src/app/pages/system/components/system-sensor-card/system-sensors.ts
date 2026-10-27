import { CoreFields } from '../../system.models';

/** Optional fields preserve older, partial and future payloads for inspection. */
export interface SystemSensor extends CoreFields {
  type?: string | null;
  device?: string | null;
  label?: string | null;
  value?: number | null;
  unit?: string | null;
  status?: string | null;
  alarm?: boolean | null;
  fault?: boolean | null;
  max?: number | null;
  critical?: number | null;
}
export interface SensorReading {
  index: number;
  raw: unknown;
  fields: CoreFields;
}
export type SensorGroup = 'processor' | 'cooling' | 'storage' | 'other';
export const groupLabels: Record<SensorGroup, string> = {
  processor: 'Procesador',
  cooling: 'Refrigeración',
  storage: 'Almacenamiento',
  other: 'Otros sensores',
};
export function fields(value: unknown): CoreFields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as CoreFields)
    : {};
}
export function sensorReadings(health: unknown): SensorReading[] {
  const sensors = fields(health)['sensors'];
  return Array.isArray(sensors)
    ? sensors.map((raw, index) => ({ index, raw, fields: fields(raw) }))
    : [];
}
export function sensorGroup(sensor: CoreFields): SensorGroup {
  if (sensor['type'] === 'fan') return 'cooling';
  if (sensor['type'] !== 'temperature') return 'other';
  const device = typeof sensor['device'] === 'string' ? sensor['device'] : '';
  if (/^(coretemp|k10temp|zenpower|cpu)(?:[._\s-]|$)/i.test(device)) return 'processor';
  if (/^(nvme|drivetemp|hddtemp)(?:[._\s-]|$)/i.test(device)) return 'storage';
  return 'other';
}
export function sensorGroups(readings: SensorReading[]) {
  return (Object.keys(groupLabels) as SensorGroup[]).map((key) => ({
    key,
    title: groupLabels[key],
    readings: readings.filter((r) => sensorGroup(r.fields) === key),
  }));
}
export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
/** Clamp only the drawing; render the original reading separately. */
export function criticalRatio(sensor: CoreFields): number | null {
  const value = sensor['value'],
    critical = sensor['critical'];
  return finite(value) && finite(critical) && critical > 0
    ? Math.max(0, Math.min(100, (value / critical) * 100))
    : null;
}
export function isCore(sensor: CoreFields): boolean {
  return (
    sensorGroup(sensor) === 'processor' &&
    sensor['type'] === 'temperature' &&
    typeof sensor['label'] === 'string' &&
    /^Core\s+\d+$/i.test(sensor['label'])
  );
}
export function coreStatistics(readings: SensorReading[]) {
  const groups = new Map<string, { device: string; unit: string; values: number[] }>();
  for (const { fields: sensor } of readings) {
    if (!isCore(sensor) || !finite(sensor['value']) || typeof sensor['device'] !== 'string')
      continue;
    const unit = sensor['unit'] === '°C' ? 'C' : sensor['unit'] === '°F' ? 'F' : sensor['unit'];
    if (unit !== 'C' && unit !== 'F' && unit !== 'K') continue;
    const key = JSON.stringify([sensor['device'], unit]);
    const group = groups.get(key) ?? { device: sensor['device'], unit, values: [] };
    group.values.push(sensor['value']);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ device, unit, values }) => ({
    device,
    unit,
    count: values.length,
    average: values.reduce((sum, value) => sum + value / values.length, 0),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  }));
}
export function healthExtras(health: unknown): unknown {
  const data = fields(health);
  if (!Object.keys(data).length) return health;
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== 'sensors' || !Array.isArray(data['sensors'])),
  );
}
export function matchesSensor(reading: SensorReading, query: string): boolean {
  return (JSON.stringify(reading.raw) ?? '')
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}
