import { Component, OnDestroy, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { JsonPipe, NgTemplateOutlet } from '@angular/common';
import { SidePanel } from '../../components/side-panel/side-panel';
import { SchedulerInspector } from './components/scheduler-inspector/scheduler-inspector';
import { SchedulerIndicators } from './components/scheduler-indicators/scheduler-indicators';
import { SchedulerFacade } from './services/scheduler.facade';
import { SchedulerList } from './components/scheduler-list/scheduler-list';
import { SchedulerCreateForm } from './components/scheduler-create-form/scheduler-create-form';

@Component({
  selector: 'app-scheduler',
  imports: [
    SchedulerIndicators,
    SchedulerInspector,
    IonContent,
    JsonPipe,
    NgTemplateOutlet,
    SidePanel,
    SchedulerList,
    SchedulerCreateForm,
  ],
  providers: [SchedulerFacade],
  templateUrl: './scheduler.html',
  styleUrl: './scheduler.scss',
})
export class Scheduler implements OnDestroy {
  readonly state = inject(SchedulerFacade);

  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
  ionViewWillLeave(): void {
    this.state.ionViewWillLeave();
  }
  ngOnDestroy(): void {
    this.state.ionViewWillLeave();
  }
}
