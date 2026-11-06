import { Component, input } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { BackupHealthState } from '../../services/health-state';
import { healthDate, limitedPrecision } from '../../utils/backups-presentation';

@Component({
  selector: 'app-backup-health-detail',
  imports: [DatePipe, JsonPipe],
  templateUrl: './backup-health-detail.html',
  styleUrl: '../../backups.scss',
})
export class BackupHealthDetail {
  readonly state = input.required<BackupHealthState>();
  readonly limitedPrecision = limitedPrecision;
  readonly healthDate = healthDate;
}
