import { Component, inject } from '@angular/core';
import { ThemeService } from '../../../../../lib/theming/theme.service';
import { themeCatalog } from '../../../../../theme/catalog';

@Component({
  selector: 'app-settings-appearance',
  templateUrl: './settings-appearance.html',
  styles: ':host { display: block; }',
})
export class SettingsAppearance {
  readonly themes = inject(ThemeService);
  readonly catalog = themeCatalog;
  readonly modes = [
    { id: 'light', label: 'Claro' },
    { id: 'dark', label: 'Oscuro' },
  ] as const;
  selectedDefinition() {
    return this.themes.themes.find((theme) => theme.id === this.themes.theme())!;
  }
  supportedModes() {
    return this.modes.filter((mode) => this.selectedDefinition().modes.includes(mode.id));
  }
  previewMode(id: string) {
    const theme = this.themes.themes.find((theme) => theme.id === id)!;
    return theme.modes.includes(this.themes.preferredMode())
      ? this.themes.preferredMode()
      : theme.defaultMode;
  }
  selectedName(): string {
    return this.catalog.find((theme) => theme.id === this.themes.theme())!.name;
  }
}
