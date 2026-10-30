import { Component, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { ThemeService } from '../../../lib/theming/theme.service';
import { themeCatalog } from '../../../theme/catalog';
import { ThemeIdentity } from '../../../theme/integration';
import { Subscription, finalize } from 'rxjs';
import { SystemService } from '../system/services/system.service';
import { SystemEquipment } from './equipment/system-equipment';

@Component({
  selector: 'app-settings',
  imports: [IonContent, SystemEquipment],
  styles: `
    app-system-equipment {
      margin-top: 2rem;
    }
  `,
  template: ` <ion-content class="console-content">
    <main class="settings-layout">
      <p class="eyebrow">KIDA CONSOLE</p>
      <h1>Settings</h1>
      <section aria-labelledby="appearance-title" class="panel">
        <h2 id="appearance-title">Apariencia</h2>
        <p>Elige el tema de tu cuenta. Los cambios se aplican al instante.</p>
        <div class="theme-gallery" role="group" aria-label="Temas">
          @for (theme of catalog; track theme.id) {
            <button
              type="button"
              class="theme-option secondary"
              [attr.aria-pressed]="themes.theme() === theme.id"
              (click)="themes.selectTheme(theme.id)"
            >
              <span
                class="theme-preview"
                [attr.data-theme]="theme.id"
                [attr.data-mode]="previewMode(theme.id)"
                aria-hidden="true"
              >
                <span class="preview-header"></span>
                <span class="preview-body"><span></span><span></span></span>
              </span>
              <strong>{{ theme.name }}</strong>
              <small>{{ theme.description }}</small>
            </button>
          }
        </div>
        @if (selectedDefinition().modes.length > 1) {
          <fieldset class="theme-modes">
            <legend>Modo</legend>
            @for (mode of supportedModes(); track mode.id) {
              <label
                ><input
                  type="radio"
                  name="theme-mode"
                  [value]="mode.id"
                  [checked]="themes.mode() === mode.id"
                  (change)="themes.selectMode(mode.id)"
                />
                {{ mode.label }}</label
              >
            }
          </fieldset>
        }
        <p role="status" aria-live="polite">
          Tema: {{ selectedName() }} · {{ themes.mode() === 'dark' ? 'Oscuro' : 'Claro' }}
        </p>
        @if (themes.persistenceUnavailable()) {
          <p class="error" role="status">
            No se puede guardar la apariencia en este navegador. Puedes seguir cambiándola durante
            esta sesión.
          </p>
        }
      </section>
      <app-system-equipment [value]="info()" [loading]="loading()" />
    </main>
  </ion-content>`,
})
export class Settings implements OnDestroy {
  private readonly service = inject(SystemService);
  private readonly identity = inject(ThemeIdentity);
  private readonly equipment = viewChild(SystemEquipment);
  readonly info = signal<unknown>(null);
  readonly loading = signal(false);
  private subscriptions = new Subscription();
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.reset());
  readonly themes = inject(ThemeService);
  readonly catalog = themeCatalog;
  readonly modes = [
    { id: 'light', label: 'Claro' },
    { id: 'dark', label: 'Oscuro' },
  ] as const;
  ionViewWillEnter(): void {
    this.reset();
    this.loadEquipment();
  }
  ionViewWillLeave(): void {
    this.reset();
  }
  ngOnDestroy(): void {
    this.ionViewWillLeave();
    this.sessionChanges.unsubscribe();
  }
  private reset(): void {
    this.equipment()?.clear();
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.info.set(null);
    this.loading.set(false);
  }
  private loadEquipment(): void {
    this.loading.set(true);
    this.subscriptions.add(
      this.service
        .info()
        .pipe(finalize(() => this.loading.set(false)))
        .subscribe({
          next: (data) => this.info.set(data),
          error: () => {},
        }),
    );
  }
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
