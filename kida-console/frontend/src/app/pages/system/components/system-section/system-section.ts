import { Component, input, output } from '@angular/core';
import { SystemSectionStatus } from '../system-section-status/system-section-status';
import { SystemSection } from '../../system.facade';

@Component({
  selector: 'app-system-section',
  imports: [SystemSectionStatus],
  templateUrl: './system-section.html',
  styles: `
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    h2 {
      margin: 0;
    }
  `,
})
export class SystemSectionView {
  readonly state = input.required<SystemSection>();
  readonly refresh = output<void>();
}
