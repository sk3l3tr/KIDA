import { Component, inject } from '@angular/core';
import { SchedulerFacade } from '../../services/scheduler.facade';
import { localDate } from '../../utils/scheduler-presentation';

@Component({
  selector: 'app-scheduler-indicators',
  templateUrl: './scheduler-indicators.html',
  styleUrl: './scheduler-indicators.scss',
})
export class SchedulerIndicators {
  readonly state = inject(SchedulerFacade);
  readonly localDate = localDate;
}
