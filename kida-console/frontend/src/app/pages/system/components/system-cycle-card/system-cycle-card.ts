import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SystemFacade } from '../../services/system.facade';

@Component({
  selector: 'app-system-cycle-card',
  imports: [FormsModule, IonicModule],
  templateUrl: './system-cycle-card.html',
  styleUrl: './system-cycle-card.scss',
})
export class SystemCycleCard {
  readonly state = inject(SystemFacade);
}
