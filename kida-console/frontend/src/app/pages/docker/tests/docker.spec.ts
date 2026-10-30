import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { createComponent, EnvironmentInjector, getDebugNode, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { environment } from '../../../../environments/environment';
import { ThemeIdentity } from '../../../../theme/integration';
import { AuthService } from '../../../auth/auth.service';
import { Observable } from 'rxjs';
import { DockerService } from '../services/docker.service';
import { Docker } from '../docker';
import { DockerView } from '../docker-view';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { DockerContainer, ComposeProject } from '../utils/docker.models';
import { composeAssociations, counter, display, dockerFailure } from '../utils/docker-presentation';
const base = `${environment.apiBaseUrl}/docker`;
const container: DockerContainer = {
  id: 'f'.repeat(64),
  name: '<img src=x onerror="alert(1)">',
  image: 'image:latest',
  online: false,
  status: 'future-status',
  health: null,
  started_at: null,
  finished_at: null,
  exit_code: 0,
  restart_count: 0,
  restart_policy: null,
  ports: [{ container_port: 0, protocol: 'future', host_ip: null, host_port: null }],
  networks: [{ name: 'net', ip_address: null, gateway: null, mac_address: null }],
  future: { value: null },
};
const inventory = { total: 99, running: 0, containers: [container], future: 'kept' };
const project: ComposeProject = {
  name: 'project /?&+#ñ',
  services: [{ name: null, containers: [container] }],
  future: null,
};
function setup(projectPanel = false) {
  TestBed.configureTestingModule({
    imports: [Docker],
    providers: [
      ...appConfig.providers,
      provideHttpClientTesting(),
      {
        provide: ArcaService,
        useFactory: () => ({
          actions: inject(ArcaActionsService),
          panels: inject(ArcaPanelsService),
        }),
      },
      { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
    ],
  });
  if (projectPanel) TestBed.overrideComponent(SidePanel, { set: { template: '<ng-content />' } });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return TestBed.inject(HttpTestingController);
}

describe('Docker HTTP through ARCA', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());
  it('gets all three read contracts, encodes project exactly, preserves nulls and future fields', () => {
    const service = TestBed.inject(DockerService);
    for (const [request, path, data] of [
      [service.list(), '/containers', inventory],
      [service.projects(), '/compose/projects', [project]],
      [
        service.inspect(project.name),
        `/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
        project,
      ],
    ] as const) {
      const next = vi.fn();
      (request as Observable<unknown>).subscribe(next);
      const r = http.expectOne(base + path);
      expect(r.request.method).toBe('GET');
      expect(r.request.withCredentials).toBe(true);
      r.flush(data);
      expect(next).toHaveBeenCalledWith(data);
    }
  });
  it.each(['start', 'stop', 'restart', 'delete'] as const)(
    'sends exact full ID body and CSRF for %s',
    (action) => {
      TestBed.inject(AuthService).csrfToken.set('isolated-test');
      const next = vi.fn();
      TestBed.inject(DockerService).act(action, container.id).subscribe(next);
      const r = http.expectOne(`${base}/containers/${action}`);
      expect(r.request.method).toBe('POST');
      expect(r.request.withCredentials).toBe(true);
      expect(r.request.headers.get('X-CSRF-Token')).toBe('isolated-test');
      expect(r.request.body).toEqual({ container: container.id });
      const response = { container: 'canonical', status: 'future', extra: null };
      r.flush(response);
      expect(next).toHaveBeenCalledWith(response);
    },
  );
});

describe('Docker page', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    http = setup(true);
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
  });
  afterEach(() => {
    http.verify();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  function enter() {
    const fixture = TestBed.createComponent(Docker);
    fixture.detectChanges();
    fixture.componentInstance.ionViewWillEnter();
    return fixture;
  }
  function initial() {
    const fixture = enter();
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/projects`).flush([project]);
    fixture.detectChanges();
    return fixture;
  }
  function view(f: ReturnType<typeof initial>, tab: 'projects' | 'containers') {
    const component = createComponent(DockerView, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector: f.debugElement.injector,
    });
    component.instance.tab = tab;
    component.changeDetectorRef.detectChanges();
    return component;
  }
  const fail = { status: 503, statusText: 'Unavailable' };
  it('opens the inventory panel locally and follows refreshed readings, failures and disappearance', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'containers');
    const root = v.location.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-side-panel')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('tbody button')!.click();
    v.changeDetectorRef.detectChanges();
    const panel = getDebugNode(root.querySelector('app-side-panel')!)!.injector.get(SidePanel);
    expect(panel.open()).toBe(true);
    expect(panel.fallbackFocus()).toBe(root.querySelector('#docker-containers-title'));
    expect(state.currentContainer()).toEqual(container);
    expect(root.querySelectorAll('tbody .action-buttons button')).toHaveLength(4);
    expect(root.querySelectorAll('app-side-panel .action-buttons button')).toHaveLength(4);
    http.expectNone(() => true);
    state.refreshContainers();
    const changed = { ...container, name: 'updated', online: true };
    http.expectOne(`${base}/containers`).flush({ ...inventory, containers: [changed] });
    expect(state.currentContainer()).toEqual(changed);
    state.refreshContainers();
    http.expectOne(`${base}/containers`).flush({ detail: { code: 'core_unavailable' } }, fail);
    v.changeDetectorRef.detectChanges();
    expect(state.currentContainer()).toEqual(changed);
    expect(root.querySelector('app-side-panel')!.textContent).toContain('desactualizados');
    state.refreshContainers();
    http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
    v.changeDetectorRef.detectChanges();
    expect(panel.open()).toBe(true);
    expect(root.querySelector('app-side-panel')!.textContent).toContain(
      'Contenedor no disponible en esta lectura',
    );
    panel.closed.emit();
    expect(state.inspectedContainer()).toBeNull();
    state.refreshContainers();
    http.expectOne(`${base}/containers`).flush(inventory);
    expect(state.inspectedContainer()).toBeNull();
  });
  it('opens from project inspection without fetching and prevents late responses from reopening or replacing selection', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.inspect(project.name);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
    const v = view(f, 'projects');
    const button = Array.from(
      v.location.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Inspeccionar ' + container.name))!;
    button.click();
    v.changeDetectorRef.detectChanges();
    expect(state.inspectedContainer()?.source).toBe('detail');
    expect(state.currentContainer()).toEqual(container);
    http.expectNone(() => true);
    state.inspect(project.name);
    const late = http.expectOne(
      `${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
    );
    state.openContainer(container.id, 'projects', project.name);
    late.flush({ ...project, services: [] });
    expect(state.currentContainer()).toEqual(container);
    state.openContainer(container.id, 'detail', project.name);
    expect(state.currentContainer()).toBeNull();
    state.leaveTab();
    expect(state.inspectedContainer()).toBeNull();
    v.changeDetectorRef.detectChanges();
    expect(v.instance.panelOpen()).toBe(false);
    state.openContainer(container.id, 'inventory');
    TestBed.inject(ThemeIdentity).begin();
    expect(state.inspectedContainer()).toBeNull();
  });
  it('retains only the same project reading on failure and never displays another project detail', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.projects.data.set([project, { name: 'second', services: [] }]);
    const v = view(f, 'projects');
    state.inspect(project.name);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
    state.inspect(project.name);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush({}, fail);
    v.changeDetectorRef.detectChanges();
    const host = v.location.nativeElement.querySelector('app-side-panel');
    expect(host.textContent).toContain('Error de inspección');
    expect(host.textContent).toContain('desactualizada');
    expect(host.textContent).toContain('Nombre: ' + project.name);
    state.inspect('second');
    state.inspect(project.name);
    http.expectNone(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`);
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).not.toContain(project.name);
    expect(host.textContent).not.toContain('Nombre: ' + project.name);
    http.expectOne(`${base}/compose/projects/inspect?project=second`).flush({}, fail);
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('Error de inspección');
    expect(host.textContent).not.toContain('desactualizada');
    state.inspect('second');
    http
      .expectOne(`${base}/compose/projects/inspect?project=second`)
      .flush({ name: 'second', services: [] });
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('0 servicios · 0 contenedores · 0 en ejecución');
    expect(host.textContent).toContain('Sin servicios');
  });
  it.each(['close', 'container', 'tab', 'session'] as const)(
    'does not reopen or replace panel contents after a late project response on %s',
    (mode) => {
      const f = initial(),
        state = f.componentInstance.state;
      const v = view(f, 'projects');
      state.inspect(project.name);
      const request = http.expectOne(
        `${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
      );
      if (mode === 'close') v.instance.closePanel();
      else if (mode === 'container') state.openContainer(container.id, 'projects', project.name);
      else if (mode === 'tab') state.leaveTab();
      else TestBed.inject(ThemeIdentity).begin();
      if (!request.cancelled) request.flush(project);
      v.changeDetectorRef.detectChanges();
      expect(state.projectPanelOpen()).toBeNull();
      if (mode === 'container') {
        expect(state.currentContainer()).toEqual(container);
        expect(v.location.nativeElement.querySelector('app-container-details')).not.toBeNull();
      } else expect(v.instance.panelOpen()).toBe(false);
    },
  );
  it('replaces project with container in the same panel and requests focus restoration to the original page trigger', async () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'projects');
    const root = v.location.nativeElement as HTMLElement;
    document.body.append(root);
    const trigger = root.querySelector<HTMLButtonElement>('app-docker-project-card footer button')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.isConnected).toBe(true);
    // Simulate browser focus: jsdom does not focus this Ionic-hosted button.
    const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(trigger);
    const focus = vi.spyOn(trigger, 'focus').mockImplementation(() => {});
    try {
      trigger.click();
      v.changeDetectorRef.detectChanges();
      http
        .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
        .flush(project);
      v.changeDetectorRef.detectChanges();
      const host = root.querySelector('app-side-panel')!;
      const panel = getDebugNode(host)!.injector.get(SidePanel);
      const inspect = host.querySelector<HTMLButtonElement>('button')!;
      active.mockReturnValue(inspect);
      inspect.click();
      v.changeDetectorRef.detectChanges();
      expect(root.querySelector('app-side-panel')).toBe(host);
      expect(panel.open()).toBe(true);
      expect(state.projectPanelOpen()).toBeNull();
      expect(state.inspectedContainer()?.source).toBe('detail');
      expect(host.querySelector('app-container-details')).not.toBeNull();
      http.expectNone(() => true);
      panel.didDismiss();
      v.changeDetectorRef.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      active.mockRestore();
      focus.mockRestore();
      root.remove();
    }
  });
  it('keeps initial failures separate from empty data and permits independent refresh', () => {
    const f = enter(),
      v = f.componentInstance.state;
    v.prepare('start', container);
    http.expectNone(`${base}/containers/start`);
    http.expectOne(`${base}/containers`).flush({ detail: { code: 'core_unavailable' } }, fail);
    http.expectOne(`${base}/compose/projects`).flush([]);
    f.detectChanges();
    expect(v.inventory.data()).toBeNull();
    expect(view(f, 'containers').location.nativeElement.textContent).not.toContain(
      'No hay contenedores.',
    );
    expect(view(f, 'projects').location.nativeElement.textContent).toContain(
      'No hay proyectos Compose.',
    );
    v.refreshContainers();
    http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
    f.detectChanges();
    expect(view(f, 'containers').location.nativeElement.textContent).toContain(
      'No hay contenedores.',
    );
  });
  it.each(['leave', 'session'] as const)(
    'retains activity across tabs and refresh, resets on %s',
    (mode) => {
      const f = initial(),
        state = f.componentInstance.state;
      state.activity.set('offline');
      state.leaveTab();
      expect(state.activity()).toBe('offline');
      state.refreshContainers();
      http
        .expectOne(`${base}/containers`)
        .flush({ ...inventory, containers: [{ ...container, online: true }] });
      expect(state.activity()).toBe('offline');
      expect(state.visibleContainers()).toEqual([]);
      state.refreshContainers();
      http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
      const v = view(f, 'containers');
      expect(v.location.nativeElement.textContent).toContain('No hay contenedores.');
      if (mode === 'leave') state.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).begin();
      expect(state.activity()).toBe('all');
    },
  );
  it('returns focus to search when an updated association hides the focused row', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'containers');
    const root = v.location.nativeElement as HTMLElement;
    document.body.append(root);
    try {
      state.search.set(project.name);
      v.changeDetectorRef.detectChanges();
      const summary = root.querySelector<HTMLElement>('tbody button')!;
      const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(summary);
      const searchFocus = vi.spyOn(
        root.querySelector<HTMLInputElement>('#docker-search')!,
        'focus',
      );
      state.refreshProjects();
      http.expectOne(`${base}/compose/projects`).flush([]);
      TestBed.flushEffects();
      v.changeDetectorRef.detectChanges();
      expect(searchFocus).toHaveBeenCalled();
      expect(root.querySelector<HTMLTableRowElement>('tbody tr')!.inert).toBe(true);
      active.mockRestore();
    } finally {
      root.remove();
    }
  });
  it('shows API totals, future states, nulls, zero, anonymous services and safe remote text', () => {
    const f = initial();
    const v = view(f, 'containers');
    v.location.nativeElement.querySelector('tbody button').click();
    v.changeDetectorRef.detectChanges();
    const rendered = v.location.nativeElement;
    expect(rendered.textContent).toContain('Total: 99');
    expect(rendered.textContent).toContain(container.name);
    expect(rendered.querySelector('img')).toBeNull();
    expect(rendered.textContent).toContain('future-status');
    expect(rendered.textContent).toContain('Salida: 0');
    expect(rendered.textContent).toContain('Reinicios: 0');
    expect(rendered.textContent).toContain('Desconocido / no disponible');
    expect(view(f, 'projects').location.nativeElement.textContent).toContain('Sin nombre');
    expect(rendered.textContent).toContain('future');
    expect(rendered.querySelectorAll('.container-list button:disabled')).toHaveLength(1);
    expect(rendered.querySelector('button[aria-label^="Parar contenedor"]').disabled).toBe(true);
  });
  it.each(['row', 'inventory', 'projects', 'detail'] as const)(
    'starts from %s using current inventory identity, sends once and refreshes both sources',
    (source) => {
      const f = initial(),
        state = f.componentInstance.state;
      const observed = { ...container, name: 'Compose old name', online: true };
      const compose = { ...project, services: [{ name: null, containers: [observed] }] };
      state.projects.data.set([compose]);
      if (source === 'detail') {
        state.inspect(project.name);
        http
          .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
          .flush(compose);
      }
      const v = view(f, source === 'projects' || source === 'detail' ? 'projects' : 'containers');
      if (source !== 'row') state.openContainer(container.id, source, project.name);
      v.changeDetectorRef.detectChanges();
      const root = v.location.nativeElement as HTMLElement;
      const scope =
        source === 'row' ? root.querySelector('tbody')! : root.querySelector('app-side-panel')!;
      const buttons = scope.querySelectorAll<HTMLButtonElement>('.action-buttons button');
      expect(buttons).toHaveLength(4);
      const start = buttons[0];
      expect(start.disabled).toBe(false);
      expect(start.getAttribute('aria-label')).toBe('Arrancar contenedor ' + container.name);
      start.click();
      start.click();
      v.changeDetectorRef.detectChanges();
      expect(start.disabled).toBe(true);
      expect(state.pending()).toBeNull();
      expect(f.nativeElement.querySelector('dialog').open).toBe(false);
      const request = http.expectOne(`${base}/containers/start`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ container: container.id });
      expect(state.resultLabel()).toBe(`play: ${container.name} (${container.id})`);
      expect(state.inventory.data()?.containers[0].online).toBe(false);
      request.flush({ container: 'canonical', status: 'accepted', extra: null });
      expect(state.busy()).toBe(true);
      http
        .expectOne(`${base}/containers`)
        .flush({ ...inventory, containers: [{ ...container, online: true }] });
      http.expectOne(`${base}/compose/projects`).flush([compose]);
      if (source === 'detail') {
        expect(state.busy()).toBe(true);
        http
          .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
          .flush(compose);
      }
      v.changeDetectorRef.detectChanges();
      expect(state.busy()).toBe(false);
      expect(start.disabled).toBe(true);
      expect(state.result()).toEqual({ container: 'canonical', status: 'accepted', extra: null });
      if (source !== 'row') {
        expect(state.inspectedContainer()?.source).toBe(source);
        expect(root.querySelector('app-side-panel')!.textContent).toContain(
          'Respuesta de CORE: canonical · accepted',
        );
      }
    },
  );
  it('blocks start by current online state in both controls and prepare while keeping other row operations', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.inventory.data.set({
      ...inventory,
      containers: [{ ...container, online: true, status: 'exited' }],
    });
    state.openContainer(container.id, 'inventory');
    const v = view(f, 'containers');
    const root = v.location.nativeElement as HTMLElement;
    const row = root.querySelectorAll<HTMLButtonElement>('tbody .action-buttons button');
    expect(row).toHaveLength(4);
    expect(row[0].disabled).toBe(true);
    expect(
      Array.from(row)
        .slice(1)
        .every((button) => !button.disabled),
    ).toBe(true);
    const start = root.querySelector<HTMLButtonElement>('app-side-panel .action-buttons button')!;
    expect(start.disabled).toBe(true);
    state.prepare('start', container);
    http.expectNone(() => true);
    state.inventory.data.set({
      ...inventory,
      containers: [{ ...container, online: false, status: 'running' }],
    });
    v.changeDetectorRef.detectChanges();
    expect(row[0].disabled).toBe(false);
    expect(start.disabled).toBe(false);
  });
  it('removes operations when a Compose target disappears from inventory and rejects absent IDs in prepare', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.openContainer(container.id, 'projects', project.name);
    const v = view(f, 'projects');
    const host = v.location.nativeElement.querySelector('app-side-panel');
    expect(host.querySelectorAll('.action-buttons button')).toHaveLength(4);
    state.inventory.data.set({ ...inventory, containers: [] });
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('Sin el mismo ID');
    expect(host.querySelectorAll('.action-buttons button')).toHaveLength(0);
    for (const action of state.actions) {
      expect(state.actionLocked(action, container.id)).toBe(true);
      state.prepare(action, container);
    }
    expect(state.pending()).toBeNull();
    http.expectNone(() => true);
  });
  it.each([
    'busy',
    'confirmation',
    'inventory',
    'projects',
    'detail',
    'uncertain',
    'missing',
  ] as const)('blocks shared controls and direct preparation of every action during %s', (mode) => {
    const f = initial(),
      state = f.componentInstance.state;
    state.openContainer(container.id, 'inventory');
    const v = view(f, 'containers');
    if (mode === 'busy') state.busy.set(true);
    else if (mode === 'confirmation') state.prepare('restart', container);
    else if (mode === 'uncertain') state.uncertain.set(true);
    else if (mode === 'missing') state.inventory.data.set(null);
    else state[mode].loading.set(true);
    v.changeDetectorRef.detectChanges();
    const root = v.location.nativeElement as HTMLElement;
    if (mode !== 'missing') {
      const buttons = root.querySelectorAll<HTMLButtonElement>(
        'app-container-actions .action-buttons button',
      );
      expect(buttons).toHaveLength(8);
      expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
    }
    const pending = state.pending();
    for (const action of state.actions) {
      expect(state.actionLocked(action, container.id)).toBe(true);
      state.prepare(action, container);
    }
    expect(state.pending()).toBe(pending);
    http.expectNone(() => true);
    if (mode === 'confirmation') state.cancel();
  });
  it('keeps inspector start results separate from refresh failures and never retries an uncertain write', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.openContainer(container.id, 'inventory');
    const v = view(f, 'containers');
    const host = v.location.nativeElement.querySelector('app-side-panel');
    host.querySelector('.action-buttons button').click();
    http
      .expectOne(`${base}/containers/start`)
      .flush({ container: container.id, status: 'accepted' });
    http.expectOne(`${base}/containers`).flush({}, fail);
    http.expectOne(`${base}/compose/projects`).flush({}, fail);
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('Respuesta de CORE:');
    expect(host.textContent).toContain('accepted');
    expect(state.inventory.stale()).toBe(true);
    expect(state.result()?.status).toBe('accepted');
    host.querySelector('.action-buttons button').click();
    http
      .expectOne(`${base}/containers/start`)
      .flush({ detail: { code: 'core_timeout' } }, { status: 504, statusText: 'Timeout' });
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('No se pudo confirmar el resultado');
    expect(host.querySelector('.action-buttons button').disabled).toBe(true);
    state.prepare('start', container);
    http.expectNone(() => true);
  });
  it.each(['inventory', 'projects'] as const)(
    'retains the start result in the %s inspector after inventory refresh removes the target',
    (source) => {
      const f = initial(),
        state = f.componentInstance.state;
      state.openContainer(container.id, source, project.name);
      const v = view(f, source === 'inventory' ? 'containers' : 'projects');
      const host = v.location.nativeElement.querySelector('app-side-panel');
      host.querySelector('.action-buttons button').click();
      http
        .expectOne(`${base}/containers/start`)
        .flush({ container: container.id, status: 'accepted' });
      http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
      http.expectOne(`${base}/compose/projects`).flush([project]);
      v.changeDetectorRef.detectChanges();
      expect(host.querySelector('.action-buttons button')).toBeNull();
      expect(host.textContent).toContain(
        source === 'inventory' ? 'Contenedor no disponible' : 'Sin el mismo ID',
      );
      expect(host.textContent).toContain('Acción solicitada:');
      expect(host.textContent).toContain('Respuesta de CORE:');
      expect(host.textContent).toContain('accepted');
      expect(v.instance.panelOpen()).toBe(true);
    },
  );
  it.each(['close', 'container', 'tab'] as const)(
    'does not reopen or replace the inspector after a start response on %s',
    (mode) => {
      const f = initial(),
        state = f.componentInstance.state;
      state.openContainer(container.id, 'inventory');
      const v = view(f, 'containers');
      v.location.nativeElement.querySelector('app-side-panel .action-buttons button').click();
      const request = http.expectOne(`${base}/containers/start`);
      if (mode === 'close') v.instance.closePanel();
      else if (mode === 'container') state.openContainer('another', 'inventory');
      else state.leaveTab();
      request.flush({ container: container.id, status: 'accepted' });
      http.expectOne(`${base}/containers`).flush(inventory);
      http.expectOne(`${base}/compose/projects`).flush([project]);
      v.changeDetectorRef.detectChanges();
      expect(state.result()?.status).toBe('accepted');
      if (mode === 'close' || mode === 'tab') expect(v.instance.panelOpen()).toBe(false);
      else expect(state.inspectedContainer()?.id).toBe('another');
    },
  );
  it.each(
    (['row', 'inventory', 'projects', 'detail'] as const).flatMap((source) =>
      (
        [
          ['stop', true],
          ['restart', true],
          ['restart', false],
          ['delete', true],
          ['delete', false],
        ] as const
      ).map(([action, online]) => ({ source, action, online })),
    ),
  )(
    'confirms $action from $source (online=$online) using current inventory without duplicate POSTs',
    ({ source, action, online }) => {
      const label = { stop: 'Parar', restart: 'Reiniciar', delete: 'Eliminar' }[action];
      const status = { stop: 'stopped', restart: 'restarted', delete: 'deleted' }[action];
      const f = initial(),
        state = f.componentInstance.state;
      const current = { ...container, online, status: online ? 'exited' : 'running' };
      const observed = { ...container, name: 'Compose stale name', online: !online };
      const compose = { ...project, services: [{ name: null, containers: [observed] }] };
      state.inventory.data.set({ ...inventory, containers: [current] });
      state.projects.data.set([compose]);
      if (source === 'detail') {
        state.inspect(project.name);
        http
          .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
          .flush(compose);
      }
      const v = view(f, source === 'row' || source === 'inventory' ? 'containers' : 'projects');
      if (source !== 'row') state.openContainer(container.id, source, project.name);
      v.changeDetectorRef.detectChanges();
      const root = v.location.nativeElement as HTMLElement;
      const scope =
        source === 'row' ? root.querySelector('tbody')! : root.querySelector('app-side-panel')!;
      const control = scope.querySelector<HTMLButtonElement>(
        `button[aria-label^="${label} contenedor"]`,
      )!;
      expect(control.disabled).toBe(false);
      control.click();
      control.click();
      v.changeDetectorRef.detectChanges();
      f.detectChanges();
      TestBed.tick();
      expect(Object.isFrozen(state.pending())).toBe(true);
      expect(state.pending()).toEqual({ action, name: container.name, id: container.id });
      const dialog = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain(container.name);
      expect(dialog.textContent).toContain(container.id);
      expect(dialog.textContent).toContain(
        action === 'delete'
          ? 'Eliminar es irreversible'
          : action === 'restart'
            ? 'interrumpir temporalmente los servicios'
            : 'interrumpir los servicios',
      );
      expect(dialog.querySelector('img')).toBeNull();
      http.expectNone(`${base}/containers/${action}`);
      state.inventory.data.set({
        ...inventory,
        containers: [{ ...current, name: 'new inventory name' }],
      });
      f.nativeElement.querySelector('.dialog-buttons button:last-child').click();
      state.confirm();
      const request = http.expectOne(`${base}/containers/${action}`);
      expect(request.request.body).toEqual({ container: container.id });
      expect(state.resultLabel()).toBe(
        `${action === 'delete' ? 'trash' : action}: ${container.name} (${container.id})`,
      );
      expect(state.inventory.data()?.containers[0].online).toBe(online);
      request.flush({
        container: container.id,
        status,
        extra: null,
      });
      http.expectOne(`${base}/containers`).flush(inventory);
      http.expectOne(`${base}/compose/projects`).flush([compose]);
      if (source === 'detail')
        http
          .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
          .flush(compose);
      v.changeDetectorRef.detectChanges();
      expect(state.busy()).toBe(false);
      expect(state.result()).toEqual({
        container: container.id,
        status,
        extra: null,
      });
      if (action === 'delete' && source !== 'row') {
        expect(scope.querySelector('.action-buttons')).toBeNull();
        expect(state.inspectedContainer()).toBeNull();
      } else expect(control.disabled).toBe(action === 'stop');
      if (source !== 'row') {
        const panel = getDebugNode(root.querySelector('app-side-panel')!)!.injector.get(SidePanel);
        expect(panel.open()).toBe(action !== 'delete');
        expect(panel.focusTrap()).toBe(true);
        expect(root.textContent).toContain('Respuesta de CORE:');
        expect(root.textContent).toContain(status);
      }
    },
  );
  it('blocks stop in controls and preparation using online instead of Docker status or a stale Compose copy', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.inventory.data.set({ ...inventory, containers: [{ ...container, status: 'running' }] });
    const stale = { ...container, online: true, status: 'exited' };
    state.projects.data.set([{ ...project, services: [{ name: null, containers: [stale] }] }]);
    state.openContainer(container.id, 'projects', project.name);
    const v = view(f, 'projects');
    const stop = v.location.nativeElement.querySelector(
      'app-side-panel button[aria-label^="Parar contenedor"]',
    );
    expect(stop.disabled).toBe(true);
    state.prepare('stop', stale);
    expect(state.pending()).toBeNull();
    http.expectNone(() => true);
    state.inventory.data.set({
      ...inventory,
      containers: [{ ...container, online: true, status: 'exited' }],
    });
    v.changeDetectorRef.detectChanges();
    expect(stop.disabled).toBe(false);
  });
  describe.each(['stop', 'restart', 'delete'] as const)('%s confirmation safeguards', (action) => {
    const label = { stop: 'Parar', restart: 'Reiniciar', delete: 'Eliminar' }[action];
    const status = { stop: 'stopped', restart: 'restarted', delete: 'deleted' }[action];
    it.each(['button', 'escape', 'cancel-event'] as const)(
      'cancels inspector action by %s, restores the lower focus trap and requests focus on its trigger',
      async (mode) => {
        const f = initial(),
          state = f.componentInstance.state;
        state.inventory.data.set({ ...inventory, containers: [{ ...container, online: true }] });
        state.openContainer(container.id, 'inventory');
        const v = view(f, 'containers');
        const root = v.location.nativeElement as HTMLElement;
        document.body.append(root);
        const stop = root.querySelector<HTMLButtonElement>(
          `app-side-panel button[aria-label^="${label} contenedor"]`,
        )!;
        const panel = getDebugNode(root.querySelector('app-side-panel')!)!.injector.get(SidePanel);
        const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(stop);
        const focus = vi.spyOn(stop, 'focus').mockImplementation(() => {});
        const show = vi
          .spyOn(HTMLDialogElement.prototype, 'showModal')
          .mockImplementation(function (this: HTMLDialogElement) {
            expect(panel.focusTrap()).toBe(false);
            this.open = true;
          });
        const documentKeydown = vi.fn();
        document.addEventListener('keydown', documentKeydown);
        try {
          stop.click();
          expect(show).not.toHaveBeenCalled();
          v.changeDetectorRef.detectChanges();
          f.detectChanges();
          TestBed.tick();
          expect(show).toHaveBeenCalledOnce();
          const dialog = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
          if (mode === 'button') dialog.querySelector<HTMLButtonElement>('[autofocus]')!.click();
          else if (mode === 'escape') {
            const event = new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            });
            dialog.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(documentKeydown).not.toHaveBeenCalled();
          } else {
            const event = new Event('cancel', { cancelable: true });
            dialog.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
          }
          v.changeDetectorRef.detectChanges();
          f.detectChanges();
          TestBed.tick();
          await f.whenStable();
          expect(dialog.open).toBe(false);
          expect(state.pending()).toBeNull();
          expect(panel.focusTrap()).toBe(true);
          expect(panel.open()).toBe(true);
          expect(focus).toHaveBeenCalledOnce();
          state.confirm();
          http.expectNone(() => true);
        } finally {
          state.cancel();
          show.mockRestore();
          active.mockRestore();
          focus.mockRestore();
          document.removeEventListener('keydown', documentKeydown);
          root.remove();
        }
      },
    );
    it.each(['close', 'container', 'project', 'tab', 'leave', 'session'] as const)(
      'invalidates an inspector action confirmation on %s without sending',
      (mode) => {
        const f = initial(),
          state = f.componentInstance.state;
        state.inventory.data.set({ ...inventory, containers: [{ ...container, online: true }] });
        state.openContainer(container.id, 'inventory');
        const v = view(f, 'containers');
        state.prepare(action, container);
        v.changeDetectorRef.detectChanges();
        f.detectChanges();
        TestBed.tick();
        expect(f.nativeElement.querySelector('dialog').open).toBe(true);
        if (mode === 'close') v.instance.closePanel();
        else if (mode === 'container') state.openContainer('another', 'inventory');
        else if (mode === 'project') {
          state.inspect(project.name);
          http
            .expectOne(
              `${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
            )
            .flush(project);
        } else if (mode === 'tab') state.leaveTab();
        else if (mode === 'leave') state.ionViewWillLeave();
        else TestBed.inject(ThemeIdentity).begin();
        v.changeDetectorRef.detectChanges();
        expect(state.pending()).toBeNull();
        expect(f.nativeElement.querySelector('dialog').open).toBe(false);
        expect(
          getDebugNode(v.location.nativeElement.querySelector('app-side-panel'))!
            .injector.get(SidePanel)
            .focusTrap(),
        ).toBe(true);
        state.confirm();
        http.expectNone(`${base}/containers/${action}`);
      },
    );
    it('does not open a deferred confirmation after the inspector closes before rendering', () => {
      const f = initial(),
        state = f.componentInstance.state;
      state.inventory.data.set({ ...inventory, containers: [{ ...container, online: true }] });
      state.openContainer(container.id, 'inventory');
      const v = view(f, 'containers');
      state.prepare(action, container);
      v.instance.closePanel();
      v.changeDetectorRef.detectChanges();
      f.detectChanges();
      TestBed.tick();
      expect(state.pending()).toBeNull();
      expect(f.nativeElement.querySelector('dialog').open).toBe(false);
      state.confirm();
      http.expectNone(() => true);
    });
    it('retains a successful action result after failed refreshes and blocks uncertain action without retrying', () => {
      const f = initial(),
        state = f.componentInstance.state;
      state.inventory.data.set({ ...inventory, containers: [{ ...container, online: true }] });
      state.openContainer(container.id, 'inventory');
      const v = view(f, 'containers');
      const host = v.location.nativeElement.querySelector('app-side-panel');
      const prepare = () => {
        state.openContainer(container.id, 'inventory');
        v.changeDetectorRef.detectChanges();
        host.querySelector(`button[aria-label^="${label} contenedor"]`).click();
        v.changeDetectorRef.detectChanges();
        f.detectChanges();
        TestBed.tick();
        state.confirm();
      };
      prepare();
      http.expectOne(`${base}/containers/${action}`).flush({ container: container.id, status });
      http.expectOne(`${base}/containers`).flush({}, fail);
      http.expectOne(`${base}/compose/projects`).flush({}, fail);
      v.changeDetectorRef.detectChanges();
      expect(v.location.nativeElement.textContent).toContain(status);
      expect(state.inventory.stale()).toBe(true);
      expect(v.instance.panelOpen()).toBe(action !== 'delete');
      expect(state.inventory.error()).not.toBe('');
      prepare();
      http
        .expectOne(`${base}/containers/${action}`)
        .flush({ detail: { code: 'core_timeout' } }, { status: 504, statusText: 'Timeout' });
      v.changeDetectorRef.detectChanges();
      expect(host.textContent).toContain('No se pudo confirmar el resultado');
      expect(v.instance.panelOpen()).toBe(true);
      expect(host.querySelector(`button[aria-label^="${label} contenedor"]`).disabled).toBe(true);
      state.prepare(action, container);
      http.expectNone(() => true);
      state.refreshProjects();
      http.expectOne(`${base}/compose/projects`).flush([project]);
      expect(state.uncertain()).toBe(true);
      state.refreshContainers();
      http.expectOne(`${base}/containers`).flush({}, fail);
      expect(state.actionLocked(action, container.id)).toBe(true);
      state.prepare(action, container);
      http.expectNone(`${base}/containers/${action}`);
      state.refreshContainers();
      http.expectOne(`${base}/containers`).flush({
        ...inventory,
        containers: [{ ...container, online: true }],
      });
      v.changeDetectorRef.detectChanges();
      expect(state.uncertain()).toBe(false);
      expect(state.actionLocked(action, container.id)).toBe(false);
      expect(host.textContent).toContain('No se pudo confirmar el resultado');
      expect(v.instance.panelOpen()).toBe(true);
      http.expectNone(`${base}/containers/${action}`);
    });
  });
  it('freezes confirmations, cancels without writes and consumes double confirmation once', () => {
    const f = initial(),
      v = f.componentInstance.state;
    const mutable = { ...container };
    v.prepare('delete', mutable);
    mutable.id = 'changed';
    mutable.name = 'changed';
    expect(Object.isFrozen(v.pending())).toBe(true);
    expect(v.pending()?.id).toBe(container.id);
    v.refreshContainers();
    http.expectNone(`${base}/containers`);
    v.cancel();
    v.confirm();
    http.expectNone(`${base}/containers/delete`);
    v.inventory.data.set({ ...inventory, containers: [{ ...container, online: true }] });
    v.prepare('stop', container);
    v.confirm();
    v.confirm();
    v.prepare('start', container);
    const r = http.expectOne(`${base}/containers/stop`);
    expect(r.request.body).toEqual({ container: container.id });
    r.flush(
      { detail: { code: 'core_error', message: 'rejected' } },
      { status: 502, statusText: 'Bad Gateway' },
    );
    expect(v.error()).toContain('CORE rechazó');
    expect(v.busy()).toBe(false);
  });
  it('recovers when opening a dialog fails', () => {
    const f = initial(),
      v = f.componentInstance.state;
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementationOnce(() => {
      throw new Error();
    });
    v.prepare('restart', container);
    expect(v.pending()).toBeNull();
    expect(v.locked()).toBe(false);
    expect(v.error()).toContain('No se pudo abrir');
    http.expectNone(`${base}/containers/restart`);
  });
  it('keeps uncertain warning and blocks actions until a successful inventory read', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.prepare('start', container);
    http
      .expectOne(`${base}/containers/start`)
      .flush({ detail: { code: 'core_timeout' } }, { status: 504, statusText: 'Timeout' });
    expect(v.uncertain()).toBe(true);
    v.prepare('start', container);
    v.prepare('delete', container);
    http.expectNone(`${base}/containers/start`);
    expect(v.pending()).toBeNull();
    v.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([project]);
    expect(v.locked()).toBe(true);
    v.refreshContainers();
    http.expectOne(`${base}/containers`).flush({}, fail);
    expect(v.locked()).toBe(true);
    v.refreshContainers();
    http.expectOne(`${base}/containers`).flush(inventory);
    expect(v.locked()).toBe(false);
    expect(v.error()).toContain('No se pudo confirmar');
  });
  it('serializes inspection, preserves stale detail and reinspects only after both inventories refresh', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.inspect(project.name);
    v.inspect(project.name);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
    v.inspect(project.name);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush({}, fail);
    expect(v.detail.data()).toEqual(project);
    expect(v.detail.stale()).toBe(true);
    v.prepare('restart', container);
    v.confirm();
    http
      .expectOne(`${base}/containers/restart`)
      .flush({ container: container.id, status: 'restarted' });
    http.expectOne(`${base}/compose/projects`).flush([project]);
    http.expectNone(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`);
    http.expectOne(`${base}/containers`).flush(inventory);
    expect(v.busy()).toBe(true);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
    expect(v.busy()).toBe(false);
  });
  it('clears vanished project and ignores its late inspection', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.inspect(project.name);
    const r = http.expectOne(
      `${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
    );
    v.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([]);
    expect(v.selected()).toBeNull();
    r.flush(project);
    expect(v.detail.data()).toBeNull();
    expect(v.detail.loading()).toBe(false);
  });
  it('does not reinspect a selection removed by post-action refresh', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.inspect(project.name);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
    v.prepare('delete', container);
    v.confirm();
    http
      .expectOne(`${base}/containers/delete`)
      .flush({ container: container.id, status: 'deleted' });
    http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
    http.expectOne(`${base}/compose/projects`).flush([]);
    expect(v.selected()).toBeNull();
    expect(v.detail.data()).toBeNull();
    expect(v.busy()).toBe(false);
  });
  it.each(['leave', 'session'] as const)(
    'cleans confirmation and ignores old responses on %s',
    (mode) => {
      const f = initial(),
        v = f.componentInstance.state;
      v.prepare('delete', container);
      v.cancel();
      v.refreshContainers();
      const old = http.expectOne(`${base}/containers`);
      if (mode === 'leave') v.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).begin();
      expect(v.pending()).toBeNull();
      expect(v.inventory.data()).toBeNull();
      old.flush(inventory);
      expect(v.inventory.data()).toBeNull();
      v.confirm();
      http.expectNone(`${base}/containers/delete`);
    },
  );
  it.each(['leave', 'session'] as const)(
    'ignores late write result after %s without refreshing or leaking data',
    (mode) => {
      const f = initial(),
        v = f.componentInstance.state;
      v.prepare('start', container);
      const old = http.expectOne(`${base}/containers/start`);
      if (mode === 'leave') v.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).begin();
      old.flush({ container: container.id, status: 'started' });
      expect(v.result()).toBeNull();
      expect(v.inventory.data()).toBeNull();
      expect(v.busy()).toBe(false);
      http.expectNone(`${base}/containers`);
      http.expectNone(`${base}/compose/projects`);
    },
  );
  it('ignores inspection responses after changing tabs', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.inspect(project.name);
    const request = http.expectOne(
      `${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
    );
    v.leaveTab();
    request.flush(project);
    expect(v.selected()).toBeNull();
    expect(v.detail.data()).toBeNull();
  });
  it('closes an open confirmation on session expiry', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.prepare('delete', container);
    expect(f.nativeElement.querySelector('dialog').open).toBe(true);
    TestBed.inject(ThemeIdentity).begin();
    expect(f.nativeElement.querySelector('dialog').open).toBe(false);
    expect(v.pending()).toBeNull();
    v.confirm();
    http.expectNone(`${base}/containers/delete`);
  });
});

describe('Docker presentation', () => {
  it('deduplicates identical associations and compares full IDs and null service names', () => {
    const associations = composeAssociations([
      { ...project, services: [project.services[0], project.services[0]] },
      {
        name: 'other',
        services: [{ name: null, containers: [{ ...container, id: container.id + 'x' }] }],
      },
    ]);
    expect(associations.get(container.id)).toEqual({ project: project.name, service: null });
    expect(associations.get(container.id + 'x')).toEqual({ project: 'other', service: null });
    expect(
      composeAssociations([
        { ...project, services: [project.services[0], { name: 'web', containers: [container] }] },
      ]).get(container.id),
    ).toBe('ambiguous');
  });
  it('preserves zeros and reports unsafe integer precision', () => {
    expect(display(null)).toContain('Desconocido');
    expect(display(0)).toBe('0');
    expect(counter(0)).toBe('0');
    expect(counter(Number.MAX_SAFE_INTEGER)).not.toContain('limitada');
    expect(counter(2 ** 64 - 1)).toContain('precisión limitada');
    expect(counter(-(2 ** 63))).toContain('precisión limitada');
  });
  it.each([
    [0, '', 'No se pudo confirmar'],
    [504, 'core_timeout', 'No se pudo confirmar'],
    [502, 'core_transport_error', 'No se pudo confirmar'],
    [502, 'core_invalid_response', 'No se pudo confirmar'],
    [503, 'core_unavailable', 'Sin conexión'],
    [502, 'core_error', 'CORE rechazó'],
    [401, '', 'sesión'],
    [422, '', 'Validación HTTP'],
  ])('classifies %s %s', (status, code, text) => {
    expect(
      dockerFailure(new HttpErrorResponse({ status, error: { detail: { code } } }), true),
    ).toContain(text);
  });
});
