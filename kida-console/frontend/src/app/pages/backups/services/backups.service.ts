import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, Subject, catchError, concatMap, tap } from 'rxjs';
import { ArcaRequestService } from '../../../services/arca-request.service';
import {
  CreateHealth,
  HealthExecution,
  HealthHistoryRecord,
  HealthQueued,
} from '../utils/health.models';
import { BackupJob, BackupsResponse, CreateBackup, Queued } from '../utils/backups.models';
import { DeletedHealthReport, HealthReport } from '../utils/reports.models';

@Injectable({ providedIn: 'root' })
export class BackupsService {
  private readonly requests = inject(ArcaRequestService);
  private readonly channels = new Map<string, Subject<() => Observable<unknown>>>();

  private request<T>(action: string, body: unknown = {}): Observable<T> {
    return new Observable<T>((observer) => {
      let channel = this.channels.get(action);
      if (!channel) {
        channel = new Subject<() => Observable<unknown>>();
        channel.pipe(concatMap((request) => request())).subscribe();
        this.channels.set(action, channel);
      }
      // ARCA shares responses per action: drain sent requests before dispatching another.
      channel.next(() =>
        observer.closed
          ? EMPTY
          : this.requests.request<T>(action, body).pipe(
              tap({
                next: (value) => observer.next(value),
                error: (failure) => observer.error(failure),
                complete: () => observer.complete(),
              }),
              catchError(() => EMPTY),
            ),
      );
    });
  }
  reportList() {
    return this.request<string[]>('BACKUP_HEALTH_REPORT_LIST');
  }
  reportGet(run_id: string) {
    return this.request<HealthReport>('BACKUP_HEALTH_REPORT_GET', {
      run_id: encodeURIComponent(run_id),
    });
  }
  reportDelete(run_id: string) {
    return this.request<DeletedHealthReport>('BACKUP_HEALTH_REPORT_DELETE', { run_id });
  }
  healthList() {
    return this.request<HealthHistoryRecord[]>('BACKUP_HEALTH_LIST');
  }
  healthGet(run_id: string) {
    return this.request<HealthExecution>('BACKUP_HEALTH_GET', {
      run_id: encodeURIComponent(run_id),
    });
  }
  healthCreate(body: CreateHealth) {
    return this.request<HealthExecution>('BACKUP_HEALTH_CREATE', body);
  }
  healthStart(run_id: string) {
    return this.request<HealthQueued>('BACKUP_HEALTH_START', { run_id });
  }
  healthRun(definition_path: string) {
    return this.request<HealthQueued>('BACKUP_HEALTH_RUN', { definition_path });
  }
  healthStop(run_id: string) {
    return this.request<HealthExecution>('BACKUP_HEALTH_STOP', { run_id });
  }
  healthDelete(run_id: string) {
    return this.request<HealthExecution>('BACKUP_HEALTH_DELETE', { run_id });
  }
  list() {
    return this.request<BackupsResponse>('BACKUP_CONFIG_LIST');
  }
  create(body: CreateBackup) {
    return this.request<BackupJob>('BACKUP_CONFIG_CREATE', body);
  }
  delete(id: string) {
    return this.request<BackupJob>('BACKUP_CONFIG_DELETE', { id });
  }
  run(id: string) {
    return this.request<Queued>('BACKUP_RUN', { id });
  }
}
