import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SchedulerFacade } from '../../services/scheduler.facade';
import { localDate, originLabels, ruleSummary } from '../../utils/scheduler-presentation';

@Component({
  selector: 'app-scheduler-list',
  imports: [FormsModule, DatePipe, JsonPipe],
  templateUrl: './scheduler-list.html',
  styleUrl: '../../scheduler.scss',
  styles: ':host { display: contents; }',
})
export class SchedulerList {
  readonly state = inject(SchedulerFacade);
  readonly localDate = localDate;
  readonly originLabels = originLabels;
  readonly ruleSummary = ruleSummary;
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');

  constructor() {
    this.state.focusFallback = () => this.listHeading()?.nativeElement;
  }
}
