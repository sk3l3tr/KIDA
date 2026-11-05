import { Component, input, output } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { BackupHealthState } from '../../services/health-state';
import { limitedPrecision } from '../../utils/backups-presentation';
import { HealthAction } from '../../utils/health.models';

@Component({
  selector: 'app-backup-health-detail',
  imports: [DatePipe, JsonPipe],
  templateUrl: './backup-health-detail.html',
  styleUrl: '../../backups.scss',
})
export class BackupHealthDetail {
  readonly state = input.required<BackupHealthState>();
  readonly prepare = output<HealthAction>();
  readonly limitedPrecision = limitedPrecision;
}
