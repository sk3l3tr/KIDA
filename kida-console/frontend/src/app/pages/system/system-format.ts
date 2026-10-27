const labels: Record<string, string> = {
  hostname: 'Nombre del equipo',
  os: 'Sistema operativo',
  kernel: 'Kernel',
  architecture: 'Arquitectura',
  hardware: 'Hardware',
  cpu: 'CPU',
  memory: 'Memoria',
  graphics: 'Gráficos',
  disks: 'Discos',
  name: 'Nombre',
  version: 'Versión',
  long_version: 'Versión completa',
  model: 'Modelo',
  vendor: 'Fabricante',
  brand: 'Marca',
  logical_cores: 'Núcleos lógicos',
  physical_cores: 'Núcleos físicos',
  total_bytes: 'Total',
  available_bytes: 'Disponible',
  used_bytes: 'En uso',
  mount_point: 'Montaje',
  file_system: 'Sistema de archivos',
  removable: 'Extraíble',
  overall: 'Estado general',
  sensors: 'Sensores',
  type: 'Tipo',
  device: 'Dispositivo',
  label: 'Etiqueta',
  value: 'Valor',
  unit: 'Unidad',
  alarm: 'Alarma',
  status: 'Estado',
  max: 'Máximo',
  critical: 'Crítico',
  fault: 'Fallo',
  rtc_device: 'Dispositivo RTC',
  rtcwake_available: 'rtcwake disponible',
  rtc_alarm_available: 'Alarma RTC disponible',
  s5_wake_status: 'Encendido físico S5',
  warnings: 'Avisos',
  scheduled: 'Programado',
  when: 'Cuándo',
  shutdown_at: 'Apagado previsto',
  wake_at: 'Encendido previsto',
  shutdown_scheduled: 'Apagado programado',
};

export function systemLabel(key: string): string {
  return labels[key] ?? key;
}

export function displaySystemValue(value: unknown, field = ''): string {
  if (value === null || value === undefined || value === '') return 'Desconocido';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value === 'unknown') return 'Desconocido (unknown)';
  if (value === 'unverified' && field === 's5_wake_status') return 'Sin verificar';
  if (typeof value === 'number' && field.endsWith('_bytes')) {
    return `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(value / 1024 ** 3)} GiB (${value} bytes)`;
  }
  return String(value);
}
