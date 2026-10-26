import { Component, forwardRef, input } from '@angular/core';

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

@Component({
  selector: 'app-system-data',
  imports: [forwardRef(() => SystemData)],
  template: `
    @if (array(value()); as items) {
      @if (!items.length) {
        <span>Sin elementos</span>
      } @else {
        <ul>
          @for (item of items; track $index) {
            <li><app-system-data [value]="item" /></li>
          }
        </ul>
      }
    } @else if (object(value()); as entries) {
      @if (!entries.length) {
        <span>Sin campos</span>
      }
      <dl>
        @for (entry of entries; track entry[0]) {
          <dt>{{ label(entry[0]) }}</dt>
          <dd><app-system-data [value]="entry[1]" [field]="entry[0]" /></dd>
        }
      </dl>
    } @else {
      <span>{{ display(value()) }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    dl {
      margin: 0;
    }
    dt {
      color: var(--kida-muted);
      font-size: 0.9rem;
      margin-top: 0.65rem;
    }
    dd {
      margin: 0.15rem 0 0.5rem 0.75rem;
    }
    ul {
      padding-left: 1.25rem;
      margin: 0.25rem 0;
    }
    li + li {
      margin-top: 0.75rem;
    }
  `,
})
export class SystemData {
  readonly value = input<unknown>();
  readonly field = input('');
  array(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
  }
  object(value: unknown): [string, unknown][] | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value)
      : null;
  }
  label(key: string) {
    return labels[key] ?? key;
  }
  display(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'Desconocido';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (value === 'unknown') return 'Desconocido (unknown)';
    if (value === 'unverified' && this.field() === 's5_wake_status') return 'Sin verificar';
    if (typeof value === 'number' && this.field().endsWith('_bytes')) {
      return `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(value / 1024 ** 3)} GiB (${value} bytes)`;
    }
    return String(value);
  }
}
