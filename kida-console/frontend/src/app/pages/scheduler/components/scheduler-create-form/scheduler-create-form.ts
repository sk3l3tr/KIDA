import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { SchedulerFacade } from '../../services/scheduler.facade';
import { createBody } from '../../utils/scheduler-form';
import { CreateSchedule } from '../../utils/scheduler.models';
import { ruleSummary } from '../../utils/scheduler-presentation';

@Component({
  selector: 'app-scheduler-create-form',
  imports: [FormsModule, JsonPipe],
  templateUrl: './scheduler-create-form.html',
  styleUrls: ['../../scheduler.scss', './scheduler-create-form.scss'],
  styles: ':host { display: contents; }',
})
export class SchedulerCreateForm {
  readonly state = inject(SchedulerFacade);
  readonly ruleSummary = ruleSummary;

  get preview(): CreateSchedule | null {
    try {
      return createBody(this.state.form);
    } catch {
      return null;
    }
  }
}
