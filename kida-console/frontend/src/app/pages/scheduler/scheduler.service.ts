import { Injectable, inject } from '@angular/core';
import { ArcaRequestService } from '../../services/arca-request.service';
import { CreateSchedule, ListedSchedule, OriginFilter, Schedule } from './scheduler.models';

@Injectable({ providedIn: 'root' })
export class SchedulerService {
  private readonly requests = inject(ArcaRequestService);
  list(origin: OriginFilter) {
    return this.requests.request<ListedSchedule[]>('SCHEDULER_LIST', { origin });
  }
  add(body: CreateSchedule) {
    return this.requests.request<Schedule>('SCHEDULER_ADD', body);
  }
  delete(body: { id: string }) {
    return this.requests.request<Schedule>('SCHEDULER_DELETE', body);
  }
}
