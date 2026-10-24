import { Subject } from 'rxjs';
import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, provideEnvironmentInitializer } from '@angular/core';
import { ThemeService } from '../lib/theming/theme.service';

@Injectable({ providedIn: 'root' })
export class ThemeIdentity {
  private readonly themes = inject(ThemeService);
  private revision = 0;
  private readonly transitions = new Subject<void>();
  readonly changes = this.transitions.asObservable();
  private readonly results = new WeakMap<object, number>();
  private primitiveRevision: number | undefined;
  // ARCA shares one response channel per action. Tag outcomes before publication
  // so a newer listener can distinguish an older HTTP request's result.
  recordResult(value: unknown, revision: number): void {
    if (value !== null && typeof value === 'object') this.results.set(value, revision);
    else this.primitiveRevision = revision;
  }
  acceptsResult(value: unknown, revision: number): boolean {
    const origin =
      value !== null && typeof value === 'object'
        ? this.results.get(value)
        : this.primitiveRevision;
    return this.isCurrent(revision) && (origin === undefined || origin === revision);
  }
  begin(): number {
    ++this.revision;
    this.transitions.next();
    this.themes.setScope(null);
    return this.revision;
  }
  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
  snapshot(): number {
    return this.revision;
  }
  confirm(revision: number, id: number | null): void {
    if (revision === this.revision) this.themes.setScope(id === null ? null : String(id));
  }
  clear(): void {
    ++this.revision;
    this.transitions.next();
    this.themes.setScope(null);
  }
}
export function provideKidaThemeIntegration() {
  return provideEnvironmentInitializer(() => {
    const themes = inject(ThemeService);
    const root = inject(DOCUMENT).documentElement;
    effect(() => root.classList.toggle('ion-palette-dark', themes.mode() === 'dark'));
  });
}
