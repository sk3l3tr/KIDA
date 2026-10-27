import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { SystemSection } from '../../system.facade';

@Component({
  selector: 'app-system-section-status',
  imports: [DatePipe, NgTemplateOutlet],
  templateUrl: './system-section-status.html',
})
export class SystemSectionStatus {
  readonly state = input.required<SystemSection>();
  readonly timestampOnly = input(false);
  readonly hideTimestamp = input(false);
}
