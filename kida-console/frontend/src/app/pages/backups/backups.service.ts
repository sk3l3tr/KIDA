import { Injectable, inject } from '@angular/core';
import { ArcaRequestService } from '../../services/arca-request.service';
import { BackupJob, BackupsResponse, CreateBackup, Queued } from './backups.models';

@Injectable({ providedIn: 'root' })
export class BackupsService {
  private readonly requests = inject(ArcaRequestService);
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
