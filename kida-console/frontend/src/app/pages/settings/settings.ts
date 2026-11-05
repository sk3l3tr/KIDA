import { Component, OnDestroy, inject, viewChild } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SettingsFacade } from './services/settings.facade';
import { SettingsAppearance } from './components/settings-appearance/settings-appearance';
import { SystemEquipment } from './components/system-equipment/system-equipment';

@Component({
  selector: 'app-settings',
  imports: [IonContent, SettingsAppearance, SystemEquipment],
  providers: [SettingsFacade],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnDestroy {
  readonly state = inject(SettingsFacade);
  private readonly equipment = viewChild(SystemEquipment);

  constructor() {
    this.state.clearEquipment = () => this.equipment()?.clear();
  }

  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
  ionViewWillLeave(): void {
    this.state.ionViewWillLeave();
  }
  ngOnDestroy(): void {
    this.state.ionViewWillLeave();
  }
}
