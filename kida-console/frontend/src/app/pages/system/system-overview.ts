import { Component, computed, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from './system.facade';
import { SystemSectionView } from './system-section';
import { SystemData } from './system-data';
import { SystemSensorCard } from './system-sensor-card';
import { coreStatistics, fields, healthExtras, isCore } from './system-sensors';
import { SystemIndicator } from './system-indicator';
import { displaySystemValue } from './system-format';

@Component({
  selector: 'app-system-overview',
  imports: [IonContent, SystemSectionView, SystemData, SystemSensorCard, SystemIndicator],
  template: `
    <ion-content class="console-content">
      <main class="system-page">
        <header class="page-heading">
          <span class="eyebrow">CONTROL DEL EQUIPO</span>
          <h1>System · Resumen</h1>
          <p>Salud y sensores del servidor CORE. Actualización manual, sin sondeo periódico.</p>
        </header>
        <section class="panel" aria-label="Salud y sensores">
          <app-system-section [state]="state.health" (refresh)="state.refresh(state.health)" />
        </section>
        <section class="indicators" aria-label="Indicadores de la instantánea">
          <app-system-indicator label="Estado general reportado" [value]="overall()" />
          <app-system-indicator
            label="Lecturas reportadas"
            [value]="state.sensorsAvailable() ? state.sensors().length : 'Desconocido'"
          />
          @for (reading of packages(); track reading.index) {
            <app-system-indicator
              [label]="display(reading.fields['device']) + ' · ' + display(reading.fields['label'])"
              [value]="display(reading.fields['value']) + ' ' + display(reading.fields['unit'])"
              [detail]="'Crítico reportado: ' + display(reading.fields['critical'])"
            />
          }
          <app-system-indicator
            label="Alarmas / fallos reportados"
            [value]="state.sensorsAvailable() ? alarms() + ' / ' + faults() : 'Desconocido'"
            detail="Solo alarm = true / fault = true"
          />
        </section>
        <div class="sensor-panels">
          @for (group of state.groups(); track group.key) {
            <section class="panel sensor-group" [attr.aria-label]="group.title">
              <div class="section-header">
                <h2>{{ group.title }}</h2>
                <small>{{ group.readings.length }} lecturas</small>
              </div>
              @if (group.key === 'processor') {
                @for (stats of statistics(); track $index) {
                  <div class="core-statistics">
                    <strong>{{ stats.device }} · {{ stats.count }} núcleos medidos</strong>
                    <dl class="stats-grid">
                      <div>
                        <dt>Más caliente</dt>
                        <dd>{{ statisticNumber.format(stats.maximum) }} {{ stats.unit }}</dd>
                      </div>
                      <div>
                        <dt>Más frío</dt>
                        <dd>{{ statisticNumber.format(stats.minimum) }} {{ stats.unit }}</dd>
                      </div>
                      <div>
                        <dt>Media</dt>
                        <dd>{{ statisticNumber.format(stats.average) }} {{ stats.unit }}</dd>
                      </div>
                    </dl>
                    <small
                      >Derivados de la instantánea, únicamente temperaturas compatibles de núcleos
                      identificados.</small
                    >
                  </div>
                }
              }
              <div class="sensor-grid" [class.core-grid]="group.key === 'processor'">
                @for (reading of group.readings; track reading.index) {
                  <app-system-sensor-card
                    [class.package-reading]="group.key === 'processor' && !isCore(reading.fields)"
                    [reading]="reading"
                    [compact]="isCore(reading.fields)"
                  />
                } @empty {
                  <p>Sin lecturas disponibles.</p>
                }
              </div>
            </section>
          }
        </div>
        @if (state.health.data() !== null) {
          <details class="panel">
            <summary>Datos Health adicionales</summary>
            <app-system-data [value]="extras()" />
          </details>
        }
      </main>
    </ion-content>
  `,
  styleUrl: './system.scss',
})
export class SystemOverview {
  readonly statisticNumber = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
  readonly state = inject(SystemFacade);
  readonly isCore = isCore;
  readonly display = displaySystemValue;
  readonly packages = computed(() =>
    this.state
      .groups()[0]
      .readings.filter(
        (r) => typeof r.fields['label'] === 'string' && /^Package id \d+$/i.test(r.fields['label']),
      ),
  );
  readonly overall = computed(() =>
    displaySystemValue(fields(this.state.health.data())['overall']),
  );
  readonly alarms = computed(
    () => this.state.sensors().filter((s) => s.fields['alarm'] === true).length,
  );
  readonly faults = computed(
    () => this.state.sensors().filter((s) => s.fields['fault'] === true).length,
  );
  readonly statistics = computed(() => coreStatistics(this.state.sensors()));
  readonly extras = computed(() => healthExtras(this.state.health.data()));
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
}
