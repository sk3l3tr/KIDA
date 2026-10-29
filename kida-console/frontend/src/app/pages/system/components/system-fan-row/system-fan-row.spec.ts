import { TestBed } from '@angular/core/testing';
import { SystemFanRow } from './system-fan-row';
import { sensorReadings } from '../system-sensor-card/system-sensors';

describe('SystemFanRow', () => {
  it('uses the muted background only for a numeric zero in RPM, including warnings', () => {
    const fixture = TestBed.createComponent(SystemFanRow);
    for (const [value, unit, status, stopped] of [
      [0, 'RPM', 'OK', true], [0, 'RPM', 'CRITICAL', true],
      [null, 'RPM', 'OK', false], ['0', 'RPM', 'OK', false],
      [0, null, 'OK', false], [1200, 'RPM', 'OK', false],
    ] as const) {
      fixture.componentRef.setInput('reading', sensorReadings({ sensors: [{ value, unit, status }] })[0]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.system-icon').classList.contains('stopped')).toBe(stopped);
    }
  });
  it('only spins for positive finite RPM and known operational states', () => {
    const fixture = TestBed.createComponent(SystemFanRow);
    for (const [value, status, spins] of [
      [1200, 'OK', true], [1200, 'CRITICAL', true], [0, 'OK', false],
      [null, 'OK', false], [Infinity, 'OK', false], ['1200', 'OK', false],
      [1200, 'FUTURE', false], [1200, null, false],
    ] as const) {
      fixture.componentRef.setInput('reading', sensorReadings({ sensors: [{ value, status, unit: 'RPM' }] })[0]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.fan-blades').classList.contains('spinning')).toBe(spins);
    }
    for (const unit of [null, 'future']) {
      fixture.componentRef.setInput('reading', sensorReadings({ sensors: [{ value: 1200, status: 'OK', unit }] })[0]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.fan-blades.spinning')).toBeNull();
    }
  });

  it('marks alarms, faults and critical status as danger even while spinning', () => {
    const fixture = TestBed.createComponent(SystemFanRow);
    for (const warning of [{ alarm: true }, { fault: true }, { status: 'CRITICAL' }]) {
      fixture.componentRef.setInput('reading', sensorReadings({ sensors: [{ value: 1200, unit: 'RPM', status: 'OK', ...warning }] })[0]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.system-icon.danger')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.fan-blades.spinning')).not.toBeNull();
    }
  });
});
