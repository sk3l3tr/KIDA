import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SystemSection } from '../../system.facade';

@Component({
  selector: 'app-system-section',
  imports: [DatePipe],
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
