import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SchedulerFacade } from '../../services/scheduler.facade';

@Component({
  selector: 'app-scheduler-create-form',
  imports: [FormsModule],
  templateUrl: './scheduler-create-form.html',
  styleUrl: '../../scheduler.scss',
  styles: ':host { display: contents; }',
})
export class SchedulerCreateForm {
  readonly state = inject(SchedulerFacade);
}
