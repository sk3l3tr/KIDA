import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OriginFilter } from '../../utils/scheduler.models';
import { SchedulerFacade } from '../../services/scheduler.facade';
import {
  localDate,
  modeLabels,
  originLabels,
  ruleSummary,
} from '../../utils/scheduler-presentation';

@Component({
  selector: 'app-scheduler-list',
  imports: [FormsModule],
  templateUrl: './scheduler-list.html',
  styleUrls: ['../../scheduler.scss', './scheduler-list.scss'],
  styles: ':host { display: contents; }',
})
export class SchedulerList {
  readonly state = inject(SchedulerFacade);
  readonly localDate = localDate;
  readonly originLabels = originLabels;
  readonly origins: OriginFilter[] = ['USER', 'INTERNAL', 'ALL'];
  readonly modeLabels = modeLabels;
  readonly ruleSummary = ruleSummary;
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');

  constructor() {
    this.state.focusFallback = () => this.listHeading()?.nativeElement;
  }
}
