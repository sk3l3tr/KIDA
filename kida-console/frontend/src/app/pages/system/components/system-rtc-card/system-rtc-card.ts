import { Component, input, output } from '@angular/core';
import { SystemSection } from '../../services/system.facade';
import { displaySystemValue } from '../../utils/system-format';
import { fields } from '../system-sensor-card/system-sensors';
import { SystemData } from '../system-data/system-data';
import { SystemSectionStatus } from '../system-section-status/system-section-status';

@Component({
  selector: 'app-system-rtc-card',
  imports: [SystemData, SystemSectionStatus],
  templateUrl: './system-rtc-card.html',
  styleUrl: './system-rtc-card.scss',
})
export class SystemRtcCard {
  readonly state = input.required<SystemSection>();
  readonly fields = fields;
  readonly display = displaySystemValue;

  warnings(value: unknown): unknown[] {
    return Array.isArray(value) ? value : value == null ? [] : [value];
  }
}
