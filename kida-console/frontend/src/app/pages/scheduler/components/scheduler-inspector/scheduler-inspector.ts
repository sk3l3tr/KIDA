import { Component, TemplateRef, inject, input } from '@angular/core';
import { DatePipe, JsonPipe, NgTemplateOutlet } from '@angular/common';
import { SidePanel } from '../../../../components/side-panel/side-panel';
import { SchedulerFacade } from '../../services/scheduler.facade';
import { localDate, modeLabels, ruleSummary } from '../../utils/scheduler-presentation';

@Component({
  selector: 'app-scheduler-inspector',
  imports: [SidePanel, DatePipe, JsonPipe, NgTemplateOutlet],
  templateUrl: './scheduler-inspector.html',
  styleUrl: './scheduler-inspector.scss',
})
export class SchedulerInspector {
  readonly state = inject(SchedulerFacade);
  readonly fallbackFocus = input<HTMLElement | null>(null);
  readonly operationStatus = input<TemplateRef<unknown> | null>(null);
  readonly localDate = localDate;
  readonly modeLabels = modeLabels;
  readonly ruleSummary = ruleSummary;
}
