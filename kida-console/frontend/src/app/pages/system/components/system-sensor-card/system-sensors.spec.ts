import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SystemFacade } from '../../system.facade';
import { SystemSensorCard } from './system-sensor-card';
import { SystemInspector } from '../system-inspector/system-inspector';
import { SystemOverview } from '../system-overview/system-overview';
import {
  coreStatistics,
  criticalRatio,
  healthExtras,
  matchesSensor,
  sensorGroups,
  sensorReadings,
} from './system-sensors';

const core = (value: unknown, extra = {}) => ({
  type: 'temperature',
  device: 'coretemp',
  label: 'Core 0',
  value,
  unit: 'C',
  ...extra,
});

describe('System sensor interpretation', () => {
  it('keeps repeated labels, multiple devices, unknown fields and non-object readings', () => {
    const raw = [
      core(0),
      core(20, { device: 'coretemp.1' }),
      { type: 'voltage', extra: false },
      null,
      0,
    ];
    const readings = sensorReadings({ sensors: raw });
    expect(readings.map((r) => r.raw)).toEqual(raw);
    expect(new Set(readings.map((r) => r.index)).size).toBe(raw.length);
    const groups = sensorGroups(readings);
    expect(groups[0].readings).toHaveLength(2);
    expect(groups[3].readings).toHaveLength(3);
    expect(matchesSensor(readings[2], 'FALSE')).toBe(true);
    expect(matchesSensor(readings[0], 'CORETEMP')).toBe(true);
  });
  it.each([null, undefined, {}, { sensors: null }, { sensors: {} }, { sensors: [] }])(
    'handles absent or empty readings: %j',
    (value) => {
      expect(sensorReadings(value)).toEqual([]);
      expect(coreStatistics(sensorReadings(value))).toEqual([]);
    },
  );
  it('retains malformed sensor fields and future Health metadata in the generic fallback', () => {
    expect(healthExtras({ sensors: 'future-format', extra: false })).toEqual({
      sensors: 'future-format',
      extra: false,
    });
    expect(healthExtras({ sensors: [], extra: false, overall: 'FUTURE' })).toEqual({
      extra: false,
      overall: 'FUTURE',
    });
  });
  it.each([
    [{ value: 0, critical: 100 }, 0],
    [{ value: 50, critical: 100 }, 50],
    [{ value: 150, critical: 100 }, 100],
    [{ value: -50, critical: 100 }, 0],
    [{ value: 50, max: 100 }, null],
    [{ value: 50, critical: 0 }, null],
    [{ value: 50, critical: -1 }, null],
    [{ value: null, critical: 100 }, null],
    [{ value: '50', critical: 100 }, null],
    [{ value: Infinity, critical: 100 }, null],
    [{ value: NaN, critical: 100 }, null],
    [{ value: 50, critical: Infinity }, null],
  ])(
    'draws only finite readings against positive reported critical thresholds: %j',
    (sensor, expected) => {
      expect(criticalRatio(sensor)).toBe(expected);
    },
  );
  it('calculates per-device compatible core statistics, excluding package, storage and unknown units', () => {
    const readings = sensorReadings({
      sensors: [
        core(0),
        core(40, { label: 'Core 1', unit: '°C' }),
        core(200, { label: 'Package id 0' }),
        core(100, { device: 'coretemp.1' }),
        core(50, { unit: 'F' }),
        core(90, { unit: null }),
        core(Infinity),
        core(null),
        core(65261.85, { device: 'nvme', label: 'Sensor 2', max: 65261.85 }),
        core(70, { device: 'future-cpu' }),
      ],
    });
    expect(coreStatistics(readings)).toEqual([
      { device: 'coretemp', unit: 'C', count: 2, minimum: 0, maximum: 40, average: 20 },
      { device: 'coretemp.1', unit: 'C', count: 1, minimum: 100, maximum: 100, average: 100 },
      { device: 'coretemp', unit: 'F', count: 1, minimum: 50, maximum: 50, average: 50 },
    ]);
  });
  it('groups fans and storage without inferring faults from zero RPM', () => {
    const readings = sensorReadings({
      sensors: [
        {
          type: 'fan',
          device: 'fan-device',
          label: 'fan1',
          value: 0,
          unit: 'RPM',
          status: 'OK',
          alarm: false,
          fault: false,
          max: 5000,
        },
        core(31.85, { device: 'nvme' }),
        core(49, { device: 'acpitz' }),
      ],
    });
    expect(sensorGroups(readings).map((g) => g.readings.length)).toEqual([0, 1, 1, 1]);
    const fixture = TestBed.createComponent(SystemSensorCard);
    fixture.componentRef.setInput('reading', readings[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0 RPM');
    expect(fixture.nativeElement.textContent).toContain('OK');
    expect(fixture.nativeElement.textContent).not.toContain('CRITICAL');
    expect(fixture.nativeElement.querySelector('.sensor-meter')).toBeNull();
  });
  it('clamps the drawing while retaining the exact reading, limits and future statuses', () => {
    const reading = sensorReadings({
      sensors: [
        core(150.123456, {
          critical: 100,
          max: 65261.85,
          status: 'FUTURE',
          future: '<script>bad()</script>',
        }),
      ],
    })[0];
    const fixture = TestBed.createComponent(SystemSensorCard);
    fixture.componentRef.setInput('reading', reading);
    fixture.detectChanges();
    const meter = fixture.nativeElement.querySelector('.sensor-meter');
    expect(meter.style.getPropertyValue('--sensor-ratio')).toBe('100%');
    expect(meter.querySelector('.sensor-meter-ring').getAttribute('aria-hidden')).toBe('true');
    expect(meter.querySelector('.sensor-value').textContent).toContain('150.123456');
    expect(fixture.nativeElement.textContent).toContain('150.123456');
    expect(fixture.nativeElement.textContent).toContain('65261.85');
    expect(fixture.nativeElement.textContent).toContain('FUTURE');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
  });
  it('keeps compact readings outside the meter even when a critical threshold is present', () => {
    const reading = sensorReadings({ sensors: [core(50, { critical: 100 })] })[0];
    const fixture = TestBed.createComponent(SystemSensorCard);
    fixture.componentRef.setInput('reading', reading);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sensor-meter')).toBeNull();
    expect(fixture.nativeElement.querySelector('.sensor-value').textContent).toContain('50');
  });
  it('shows processor summaries only with matching device and unit, retaining other readings', () => {
    const data = signal<unknown>({ sensors: [
      core(50, { label: 'Package id 0', critical: 100 }),
      core(40), core(60, { label: 'Core 1' }),
      core(90, { device: 'coretemp.1', label: 'Package id 1', unit: 'F' }),
      core(30, { device: 'coretemp.1', unit: 'C' }),
      core(10, { label: 'Auxiliary' }),
    ] });
    const sensors = () => sensorReadings(data());
    TestBed.configureTestingModule({ providers: [{ provide: SystemFacade, useValue: {
      health: { title: 'Salud', data, loading: signal(false), updated: signal(null), error: signal('') },
      sensorsAvailable: () => true, sensors, groups: () => sensorGroups(sensors()),
    } }] });
    const fixture = TestBed.createComponent(SystemOverview);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('[aria-label="Procesador"]');
    const summaries = panel.querySelectorAll('.processor-package');
    expect(panel.textContent).toContain('3 núcleos medidos');
    expect(summaries).toHaveLength(2);
    expect(summaries[0].textContent).toContain('60 C');
    expect(summaries[0].textContent).toContain('40 C');
    expect(summaries[0].textContent).toContain('50 C');
    expect(summaries[0].textContent).toContain('100 C');
    expect(summaries[0].textContent).not.toContain('Alarma');
    expect(summaries[1].textContent).toContain('Desconocido');
    expect(summaries[1].textContent).not.toContain('30 C');
    expect(panel.querySelectorAll('app-system-sensor-card')).toHaveLength(6);
    expect(panel.textContent).toContain('Auxiliary');
    data.set({ sensors: [] });
    fixture.detectChanges();
    expect(panel.textContent).toContain('0 núcleos medidos');
    expect(panel.textContent).toContain('Sin lecturas disponibles.');
    expect(panel.querySelectorAll('app-system-sensor-card')).toHaveLength(0);
  });
  it('searches all original fields and preserves all duplicate and unknown readings in the inspector', () => {
    const data = signal<unknown>({ sensors: [core(1), core(2), { future: { text: 'visible' } }] });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SystemFacade,
          useValue: {
            health: {
              title: 'Salud',
              data,
              loading: signal(false),
              updated: signal(null),
              error: signal(''),
            },
            sensorsAvailable: () => true,
            sensors: () => sensorReadings(data()),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SystemInspector);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
    fixture.componentInstance.query.set('visible');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('visible');
    fixture.componentInstance.query.set('absent');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin sensores coincidentes');
    fixture.componentInstance.query.set('');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});
