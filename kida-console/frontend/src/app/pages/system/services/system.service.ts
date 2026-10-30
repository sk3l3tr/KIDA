import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ArcaRequestService } from '../../../services/arca-request.service';
import {
  CycleResult,
  PendingAction,
  PowerResult,
  SystemHealth,
  SystemInfo,
  WakeCapabilities,
} from '../utils/system.models';

@Injectable({ providedIn: 'root' })
export class SystemService {
  private readonly requests = inject(ArcaRequestService);

  info() {
    return this.requests.request<SystemInfo>('SYSTEM_INFO');
  }

  health() {
    return this.requests.request<SystemHealth>('SYSTEM_HEALTH');
  }

  wakeCapabilities() {
    return this.requests.request<WakeCapabilities>('SYSTEM_WAKE_CAPABILITIES');
  }

  powerCycle(pending: PendingAction) {
    return this.requests.request<CycleResult>('SYSTEM_POWER_CYCLE', pending.body);
  }

  shutdown(pending: PendingAction) {
    return this.requests.request<PowerResult>('SYSTEM_SHUTDOWN', pending.body);
  }

  reboot(pending: PendingAction) {
    return this.requests.request<PowerResult>('SYSTEM_REBOOT', pending.body);
  }

  execute(pending: PendingAction): Observable<CycleResult | PowerResult> {
    if (pending.action === 'powerCycle') return this.powerCycle(pending);
    if (pending.action === 'shutdown') return this.shutdown(pending);
    return this.reboot(pending);
  }
}
