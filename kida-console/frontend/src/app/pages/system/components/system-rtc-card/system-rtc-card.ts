import { Component, input } from '@angular/core';
import { SystemSection } from '../../services/system.facade';
import { WakeCapabilities } from '../../utils/system.models';
import { displaySystemValue } from '../../utils/system-format';
import { fields } from '../system-sensor-card/system-sensors';
import { SystemSectionStatus } from '../system-section-status/system-section-status';

@Component({
  selector: 'app-system-rtc-card',
  imports: [SystemSectionStatus],
  templateUrl: './system-rtc-card.html',
  styleUrl: './system-rtc-card.scss',
})
export class SystemRtcCard {
  readonly state = input.required<SystemSection<WakeCapabilities>>();
  readonly fields = fields;
  readonly display = displaySystemValue;

  warnings(value: unknown): unknown[] {
    return Array.isArray(value) ? value : value == null ? [] : [value];
  }
}
