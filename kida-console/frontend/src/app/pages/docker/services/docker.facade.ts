import { trapDialogFocus, restoreDialogFocus } from '../../../services/dialog-focus';
import {
  Injectable,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Observable, Subscription, catchError, finalize, forkJoin, map, of, tap } from 'rxjs';
import { ThemeIdentity } from '../../../../theme/integration';
import { classifyCoreFailure } from '../../../services/core-failure';
import { DockerService } from './docker.service';
import {
  ComposeProject,
  ComposeVersion,
  ContainerAction,
  ContainerResult,
  DockerContainer,
  DockerContainers,
  PendingContainer,
} from '../utils/docker.models';
import {
  actionLabels,
  composeAssociations,
  counter,
  display,
  dockerFailure,
  limitedPrecision,
} from '../utils/docker-presentation';

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
  readonly projectPanelOpen = signal<string | null>(null);
  readonly inventoryPanelOpen = signal(false);
  readonly projects = reading<ComposeProject[]>();
  readonly associations = computed(() => {
    const projects = this.projects.data();
    return projects === null ? null : composeAssociations(projects);
  });
  readonly search = signal('');
  readonly activity = signal<'all' | 'online' | 'offline'>('all');
  readonly visibleContainers = computed(() => {
    const containers = this.inventory.data()?.containers ?? [];
    const query = this.search().trim().toLowerCase();
    const activity = this.activity();
    const associations = this.associations();
    return containers.filter((container) => {
      if (activity === 'online' && !container.online) return false;
      if (activity === 'offline' && container.online) return false;
      if (!query) return true;
      const association = associations?.get(container.id);
      const fields = [container.name, container.id, container.image];
      if (association && association !== 'ambiguous') {
        fields.push(association.project);
        if (association.service !== null) fields.push(association.service);
      }
      return fields.some((field) => field.toLowerCase().includes(query));
    });
  });
  readonly visibleContainerIds = computed(
    () => new Set(this.visibleContainers().map((container) => container.id)),
  );
  readonly expandedServices = signal<Record<string, string[]>>({});
  readonly inspectedContainer = signal<{
    id: string;
    source: 'inventory' | 'projects' | 'detail';
    project?: string;
  } | null>(null);
  readonly containerReading = computed(() => {
    const selected = this.inspectedContainer();
    if (selected?.source === 'projects') return this.projects;
    if (selected?.source === 'detail') return this.detail;
    return this.inventory;
  });
  readonly currentContainer = computed(() => {
    const selected = this.inspectedContainer();
    if (!selected) return null;
    if (selected.source === 'inventory') {
      return this.inventory.data()?.containers.find((c) => c.id === selected.id) ?? null;
    }
    const project =
      selected.source === 'projects'
        ? this.projects.data()?.find((p) => p.name === selected.project)
        : this.selected() === selected.project
          ? this.detail.data()
          : null;
    return project?.services.flatMap((s) => s.containers).find((c) => c.id === selected.id) ?? null;
  });
  readonly containerInInventory = computed(() => {
    const selected = this.inspectedContainer();
    return this.inventory.data()?.containers.find((c) => c.id === selected?.id) ?? null;
  });
  openContainer(id: string, source: 'inventory' | 'projects' | 'detail', project?: string): void {
    if (!this.active) return;
    this.invalidateConfirmation();
    this.inventoryPanelOpen.set(false);
    this.versionPanelOpen.set(null);
    this.projectPanelOpen.set(null);
    this.inspectedContainer.set({ id, source, project });
  }
  openVersion(tab: 'projects' | 'containers'): void {
    this.invalidateConfirmation();
    this.inventoryPanelOpen.set(false);
    this.inspectedContainer.set(null);
    this.projectPanelOpen.set(null);
    this.versionPanelOpen.set(tab);
  }
  openInventory(): void {
    if (!this.active || this.inventory.data() === null) return;
    this.invalidateConfirmation();
    this.inspectedContainer.set(null);
    this.projectPanelOpen.set(null);
    this.versionPanelOpen.set(null);
    this.inventoryPanelOpen.set(true);
  }
  readonly detail = reading<ComposeProject>();
  readonly selected = signal<string | null>(null);
  readonly inspectedProjectTotals = computed(() => {
    const project = this.detail.data();
    const containers = project?.services.flatMap((service) => service.containers) ?? [];
    return {
      services: project?.services.length ?? 0,
      containers: containers.length,
      online: containers.filter((container) => container.online).length,
    };
  });
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
    this.inventoryPanelOpen.set(false);
    this.projectPanelOpen.set(null);
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
    this.inventoryPanelOpen.set(false);
    this.projectPanelOpen.set(null);
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
    this.search.set('');
    this.activity.set('all');
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
      (!afterWrite && this.busy()) ||
      !this.projects.data()?.some((p) => p.name === project)
    )
      return;
    if (!afterWrite) this.invalidateConfirmation();
    if (this.selected() !== project) {
      this.detail.data.set(null);
      this.detail.stale.set(false);
    }
    this.selected.set(project);
    if (!afterWrite) {
      this.inventoryPanelOpen.set(false);
      this.versionPanelOpen.set(null);
      this.inspectedContainer.set(null);
      this.projectPanelOpen.set(project);
    }
    const generation = this.generation,
      revision = this.identity.snapshot();
    this.detail.loading.set(true);
    this.detail.error.set('');
    const selectionRevision = this.selectionRevision;
    const applies = () =>
      this.valid(generation, revision) &&
      this.selectionRevision === selectionRevision &&
      this.selected() === project;
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
  actionLocked(action: ContainerAction, id: string): boolean {
    const container = this.inventory.data()?.containers.find((c) => c.id === id);
    return (
      this.locked() ||
      !container ||
      (action === 'start' && container.online) ||
      (action === 'stop' && !container.online)
    );
  }
  prepare(action: ContainerAction, container: DockerContainer): void {
    const current = this.inventory.data()?.containers.find((c) => c.id === container.id);
    if (!this.active || !current || this.actionLocked(action, current.id)) return;
    this.trigger = this.document.activeElement;
    const snapshot = Object.freeze({ action, id: current.id, name: current.name });
    if (action === 'start') {
      this.execute(snapshot);
      return;
    }
    this.error.set('');
    this.pending.set(snapshot);
    const show = () => {
      if (!this.active || this.pending() !== snapshot) return;
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
    };
    // Apply the lower modal's focusTrap binding before opening the native dialog.
    if (this.inspectedContainer()) afterNextRender(show, { injector: this.injector });
    else show();
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
  invalidateConfirmation(): void {
    this.closeConfirmation();
    this.trigger = null;
  }
  confirm(): void {
    const pending = this.pending();
    if (!this.active || !pending || this.busy() || !this.dialog()?.open) return;
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
    if (event.key === 'Escape' && this.pending()) {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return;
    }
    trapDialogFocus(event, this.dialog(), this.document);
  }
  private restoreFocus(): void {
    const generation = this.generation;
    const trigger = this.trigger;
    if (!trigger) return;
    const selectionRevision = this.selectionRevision;
    const container = this.inspectedContainer();
    const version = this.versionPanelOpen();
    const project = this.projectPanelOpen();
    const inventory = this.inventoryPanelOpen();
    restoreDialogFocus(
      this.injector,
      trigger,
      () => this.heading(),
      () =>
        this.active &&
        generation === this.generation &&
        selectionRevision === this.selectionRevision &&
        container === this.inspectedContainer() &&
        version === this.versionPanelOpen() &&
        project === this.projectPanelOpen() &&
        inventory === this.inventoryPanelOpen(),
    );
  }
}
