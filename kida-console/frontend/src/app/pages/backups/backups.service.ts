import { Injectable, inject } from '@angular/core';
import { ArcaRequestService } from '../../services/arca-request.service';
import { CreateHealth, HealthExecution, HealthHistoryRecord } from './health.models';
import { BackupJob, BackupsResponse, CreateBackup, Queued } from './backups.models';

@Injectable({ providedIn: 'root' })
export class BackupsService {
  private readonly requests = inject(ArcaRequestService);
  healthList() {
    return this.requests.request<HealthHistoryRecord[]>('BACKUP_HEALTH_LIST');
  }
  healthGet(run_id: string) {
    return this.requests.request<HealthExecution>('BACKUP_HEALTH_GET', {
      run_id: encodeURIComponent(run_id),
    });
  }
  healthCreate(body: CreateHealth) {
    return this.requests.request<HealthExecution>('BACKUP_HEALTH_CREATE', body);
  }
  list() {
    return this.requests.request<BackupsResponse>('BACKUP_CONFIG_LIST');
  }
  create(body: CreateBackup) {
    return this.requests.request<BackupJob>('BACKUP_CONFIG_CREATE', body);
  }
  delete(id: string) {
    return this.requests.request<BackupJob>('BACKUP_CONFIG_DELETE', { id });
  }
  run(id: string) {
    return this.requests.request<Queued>('BACKUP_RUN', { id });
  }
}
