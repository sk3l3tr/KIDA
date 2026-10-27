import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemFacade } from '../../system.facade';

@Component({
  selector: 'app-system-power-card',
  imports: [FormsModule],
  templateUrl: './system-power-card.html',
  styleUrl: './system-power-card.scss',
})
export class SystemPowerCard {
  readonly state = inject(SystemFacade);
}
