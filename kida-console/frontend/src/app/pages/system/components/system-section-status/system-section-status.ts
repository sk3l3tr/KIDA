import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { SystemSection } from '../../services/system.facade';

@Component({
  selector: 'app-system-section-status',
  imports: [DatePipe, NgTemplateOutlet],
  templateUrl: './system-section-status.html',
})
export class SystemSectionStatus<T> {
  readonly state = input.required<SystemSection<T>>();
  readonly timestampOnly = input(false);
  readonly hideTimestamp = input(false);
}
