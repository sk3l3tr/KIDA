import { trapDialogFocus, restoreDialogFocus } from '../../services/dialog-focus';
import {
  Injectable,
  Injector,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Observable, Subscription, catchError, finalize, forkJoin, map, of, tap } from 'rxjs';
import { ThemeIdentity } from '../../../theme/integration';
import { classifyCoreFailure } from '../../services/core-failure';
import { DockerService } from './docker.service';
import {
  ComposeProject,
  ComposeVersion,
  ContainerAction,
  ContainerResult,
  DockerContainer,
  DockerContainers,
  PendingContainer,
} from './docker.models';
import {
  actionLabels,
  counter,
  display,
  dockerFailure,
  limitedPrecision,
} from './docker-presentation';

/** Each reading retains its last successful value independently of refresh errors. */
function reading<T>() {
  return {
    data: signal<T | null>(null),
    loading: signal(false),
    error: signal(''),
    stale: signal(false),
  };
}

export function serviceKeys(project: ComposeProject): string[] {
  const occurrences = new Map<string | null, number>();
  return project.services.map((service) => {
    const occurrence = occurrences.get(service.name) ?? 0;
    occurrences.set(service.name, occurrence + 1);
    return JSON.stringify([service.name, occurrence]);
  });
}

@Injectable()
export class DockerFacade implements OnDestroy {
  private readonly service = inject(DockerService);
  private readonly identity = inject(ThemeIdentity);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  dialog: () => HTMLDialogElement | undefined = () => undefined;
  heading: () => HTMLElement | undefined = () => undefined;
  readonly inventory = reading<DockerContainers>();
  readonly version = reading<ComposeVersion>();
  readonly versionPanelOpen = signal<'projects' | 'containers' | null>(null);
  readonly projects = reading<ComposeProject[]>();
  readonly expandedServices = signal<Record<string, string[]>>({});
  readonly inspectedContainer = signal<{ project: string; service: string; id: string } | null>(null);
  readonly detail = reading<ComposeProject>();
  readonly selected = signal<string | null>(null);
  readonly busy = signal(false);
  readonly pending = signal<PendingContainer | null>(null);
  readonly uncertain = signal(false);
  readonly error = signal('');
  readonly result = signal<ContainerResult | null>(null);
  readonly resultLabel = signal('');
  readonly actions: ContainerAction[] = ['start', 'stop', 'restart', 'delete'];
  readonly labels = actionLabels;
  readonly display = display;
  readonly counter = counter;
  readonly limitedPrecision = limitedPrecision;
  readonly locked = computed(
    () =>
      this.busy() ||
      this.pending() !== null ||
      this.inventory.loading() ||
      this.projects.loading() ||
      this.detail.loading() ||
      this.uncertain() ||
      this.inventory.data() === null,
  );
  private active = false;
  private generation = 0;
  private selectionRevision = 0;
  private subscriptions = new Subscription();
  private trigger: Element | null = null;
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.reset());

  ionViewWillEnter(): void {
    if (this.active) return;
    this.reset();
    this.active = true;
    this.refreshContainers();
    this.refreshVersion();
    this.refreshProjects();
  }
  ionViewWillLeave(): void {
    this.reset();
  }
  ngOnDestroy(): void {
    this.reset();
    this.sessionChanges.unsubscribe();
  }
  leaveTab(): void {
    this.versionPanelOpen.set(null);
    this.inspectedContainer.set(null);
    ++this.selectionRevision;
    this.closeConfirmation();
    this.selected.set(null);
    this.detail.data.set(null);
    this.detail.error.set('');
    this.detail.stale.set(false);
    this.trigger = null;
  }
  private reset(): void {
    this.versionPanelOpen.set(null);
    this.active = false;
    ++this.generation;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.closeConfirmation();
    for (const state of [this.inventory, this.version, this.projects, this.detail]) {
      state.data.set(null);
      state.loading.set(false);
      state.error.set('');
      state.stale.set(false);
    }
    this.selected.set(null);
    this.expandedServices.set({});
    this.inspectedContainer.set(null);
    this.busy.set(false);
    this.uncertain.set(false);
    this.error.set('');
    this.result.set(null);
    this.resultLabel.set('');
    this.trigger = null;
  }
  private valid(generation: number, revision: number): boolean {
    return this.active && generation === this.generation && revision === this.identity.snapshot();
  }
  private load<T>(
    state: ReturnType<typeof reading<T>>,
    request: Observable<T>,
    accept: (value: T) => void = () => {},
  ): Observable<boolean> {
    const generation = this.generation,
      revision = this.identity.snapshot();
    state.loading.set(true);
    state.error.set('');
    return request.pipe(
      tap((value) => {
        if (!this.valid(generation, revision)) return;
        state.data.set(value);
        state.stale.set(false);
        accept(value);
      }),
      map(() => true),
      catchError((failure) => {
        if (this.valid(generation, revision)) {
          state.error.set(dockerFailure(failure));
          state.stale.set(state.data() !== null);
        }
        return of(false);
      }),
      finalize(() => {
        if (this.valid(generation, revision)) state.loading.set(false);
      }),
    );
  }
  private canRefresh(): boolean {
    return this.active && !this.busy() && this.pending() === null;
  }
  refreshContainers(): void {
    if (!this.canRefresh() || this.inventory.loading()) return;
    this.subscriptions.add(this.loadContainers().subscribe());
  }
  private loadContainers(): Observable<boolean> {
    return this.load(this.inventory, this.service.list(), () => this.uncertain.set(false));
  }
  refreshVersion(): void {
    if (!this.canRefresh() || this.version.loading()) return;
    this.subscriptions.add(this.load(this.version, this.service.version()).subscribe());
  }
  refreshProjects(): void {
    if (!this.canRefresh() || this.projects.loading()) return;
    this.subscriptions.add(this.loadProjects().subscribe());
  }
  private loadProjects(): Observable<boolean> {
    return this.load(this.projects, this.service.projects(), (projects) => {
      const previous = this.expandedServices();
      const next: Record<string, string[]> = Object.create(null);
      for (const project of projects) {
        const keys = serviceKeys(project);
        if (keys.length === 0 && !Object.hasOwn(previous, project.name)) continue;
        next[project.name] = Object.hasOwn(previous, project.name)
          ? previous[project.name].filter((key) => keys.includes(key))
          : keys.slice(0, 1);
      }
      this.expandedServices.set(next);
      const inspected = this.inspectedContainer();
      if (inspected && !projects.some((project) =>
        project.name === inspected.project && project.services.some((service, index) =>
          serviceKeys(project)[index] === inspected.service && service.containers.some((container) => container.id === inspected.id),
        ),
      )) this.inspectedContainer.set(null);
      if (
        this.selected() !== null &&
        !projects.some((project) => project.name === this.selected())
      ) {
        this.selected.set(null);
        this.detail.data.set(null);
        this.detail.error.set('');
        this.detail.stale.set(false);
      }
    });
  }
  setExpandedServices(project: string, values: string[]): void {
    this.expandedServices.update((current) => ({ ...current, [project]: values }));
  }
  inspect(project: string, afterWrite = false): void {
    if (
      !this.active ||
      this.detail.loading() ||
      (!afterWrite && (this.busy() || this.pending() !== null)) ||
      !this.projects.data()?.some((p) => p.name === project)
    )
      return;
    if (this.selected() !== project) {
      this.detail.data.set(null);
      this.detail.stale.set(false);
    }
    this.selected.set(project);
    const generation = this.generation,
      revision = this.identity.snapshot();
    this.detail.loading.set(true);
    this.detail.error.set('');
    const selectionRevision = this.selectionRevision;
    const applies = () => this.valid(generation, revision) && this.selectionRevision === selectionRevision && this.selected() === project;
    this.subscriptions.add(
      this.service
        .inspect(project)
        .pipe(
          finalize(() => {
            if (this.valid(generation, revision)) this.detail.loading.set(false);
            if (afterWrite && this.valid(generation, revision)) {
              this.busy.set(false);
              this.restoreFocus();
            }
          }),
        )
        .subscribe({
          next: (value) => {
            if (!applies()) return;
            this.detail.data.set(value);
            this.detail.stale.set(false);
          },
          error: (failure) => {
            if (!applies()) return;
            this.detail.error.set(dockerFailure(failure));
            this.detail.stale.set(this.detail.data() !== null);
          },
        }),
    );
  }
  prepare(action: ContainerAction, container: DockerContainer): void {
    if (!this.active || this.locked()) return;
    this.trigger = this.document.activeElement;
    const snapshot = Object.freeze({ action, id: container.id, name: container.name });
    if (action === 'start') {
      this.execute(snapshot);
      return;
    }
    this.error.set('');
    this.pending.set(snapshot);
    try {
      const dialog = this.dialog();
      if (!dialog) throw new Error('Confirmation unavailable');
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
    } catch {
      this.closeConfirmation();
      this.error.set('No se pudo abrir la confirmación.');
      this.restoreFocus();
    }
  }
  cancel(): void {
    if (!this.pending()) return;
    this.closeConfirmation();
    this.restoreFocus();
  }
  private closeConfirmation(): void {
    this.pending.set(null);
    const dialog = this.dialog();
    if (dialog?.open) dialog.close();
  }
  confirm(): void {
    const pending = this.pending();
    if (!this.active || !pending || this.busy()) return;
    this.closeConfirmation();
    this.execute(pending);
  }
  private execute(snapshot: PendingContainer): void {
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    this.resultLabel.set(`${this.labels[snapshot.action]}: ${snapshot.name} (${snapshot.id})`);
    const generation = this.generation,
      revision = this.identity.snapshot();
    this.subscriptions.add(
      this.service.act(snapshot.action, snapshot.id).subscribe({
        next: (result) => {
          if (!this.valid(generation, revision)) return;
          this.result.set(result);
          this.inventory.stale.set(true);
          this.projects.stale.set(true);
          if (this.detail.data() !== null) this.detail.stale.set(true);
          this.subscriptions.add(
            forkJoin([this.loadContainers(), this.loadProjects()]).subscribe(([_, projectsOk]) => {
              if (!this.valid(generation, revision)) return;
              const selected = this.selected();
              if (projectsOk && selected !== null) this.inspect(selected, true);
              else {
                this.busy.set(false);
                this.restoreFocus();
              }
            }),
          );
        },
        error: (failure) => {
          if (!this.valid(generation, revision)) return;
          this.error.set(dockerFailure(failure, true));
          if (classifyCoreFailure(failure, true).kind === 'uncertain') {
            this.uncertain.set(true);
            this.inventory.stale.set(true);
            this.projects.stale.set(true);
            if (this.detail.data() !== null) this.detail.stale.set(true);
          }
          this.busy.set(false);
          this.restoreFocus();
        },
      }),
    );
  }
  trapFocus(event: KeyboardEvent): void {
    trapDialogFocus(event, this.dialog(), this.document);
  }
  private restoreFocus(): void {
    const generation = this.generation;
    const trigger = this.trigger;
    if (!trigger) return;
    const selectionRevision = this.selectionRevision;
    restoreDialogFocus(
      this.injector,
      trigger,
      () => this.heading(),
      () => this.active && generation === this.generation && selectionRevision === this.selectionRevision,
    );
  }
}
