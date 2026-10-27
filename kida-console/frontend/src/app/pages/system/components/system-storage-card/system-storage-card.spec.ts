import { TestBed } from '@angular/core/testing';
import { sensorReadings } from '../system-sensor-card/system-sensors';
import { storageDevices, SystemStorageCard } from './system-storage-card';

describe('Storage readings', () => {
  it.each([
    [50, 100, '50 %', '50%'],
    [150, 100, '150 %', '100%'],
    [-50, 100, '-50 %', '0%'],
    [null, 100, 'Desconocido', null],
    [50, null, 'Desconocido', null],
    [50, 0, 'Desconocido', null],
    [50, -1, 'Desconocido', null],
    [Infinity, 100, 'Desconocido', null],
    [50, Infinity, 'Desconocido', null],
    [Number.MAX_VALUE, Number.MIN_VALUE, 'Desconocido', null],
    ['50', 100, 'Desconocido', null],
  ])('shows %s against %s without altering the values', (value, critical, percentage, width) => {
    const reading = sensorReadings({ sensors: [{ type: 'temperature', device: 'nvme', label: 'Sensor', value, critical, unit: null, status: 'FUTURE' }] })[0];
    const fixture = TestBed.createComponent(SystemStorageCard);
    fixture.componentRef.setInput('readings', [reading]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).not.toContain('FUTURE');
    expect(element.textContent).toContain(`Porcentaje del umbral crítico: ${percentage}`);
    expect(element.textContent).toContain(value === null ? 'Desconocido' : String(value));
    expect(element.textContent).toContain(critical === null ? 'Desconocido' : String(critical));
    expect(element.querySelector('.storage-meter span')?.getAttribute('style') ?? null).toBe(width === null ? null : `width: ${width};`);
  });
  it('groups exact device names and prioritizes the first Composite while preserving other readings', () => {
    const readings = sensorReadings({ sensors: [
      { device: 'nvme', label: 'Sensor 1', value: 10, unit: 'C' },
      { device: 'nvme', label: 'cOmPoSiTe', value: 20, unit: 'C', critical: 100 },
      { device: 'nvme1', label: 'Other', value: 30, unit: null },
      { device: 'nvme', label: 'Composite', value: null, unit: null },
      { device: 'nvme1', label: 'Next', value: 40, unit: 'C' },
    ] });
    const groups = storageDevices(readings);
    expect(groups).toEqual([[readings[0], readings[1], readings[3]], [readings[2], readings[4]]]);
    const fixture = TestBed.createComponent(SystemStorageCard);
    fixture.componentRef.setInput('readings', groups[0]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.storage-value')?.textContent).toContain('20');
    expect([...element.querySelectorAll('.storage-secondary')].map((row) => row.textContent)).toEqual([
      expect.stringContaining('Sensor 1'), expect.stringContaining('Composite'),
    ]);
    expect(element.querySelectorAll('.storage-secondary')[1].textContent).toContain('Desconocido');
    fixture.componentRef.setInput('readings', groups[1]);
    fixture.detectChanges();
    expect(element.querySelector('.storage-value')?.textContent).toContain('30');
    expect(element.querySelectorAll('.storage-secondary')).toHaveLength(1);
    expect(element.querySelector('.storage-secondary')?.textContent).toContain('Next');
  });
});
