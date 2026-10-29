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
import { ChannelBusyError } from '../../../services/arca-request.service';
import { Observable } from 'rxjs';
import { DockerService } from '../services/docker.service';
import { Docker } from '../docker';
import { DockerView } from '../docker-view';
import { SidePanel } from '../../../components/side-panel/side-panel';
import { DockerContainer, ComposeProject } from '../utils/docker.models';
import { dockerActions } from '../utils/docker.actions';
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
  it('registers eight independent channels without loader', () => {
    expect(dockerActions).toHaveLength(8);
    expect(new Set(dockerActions.map((a) => a.actionName)).size).toBe(8);
    for (const a of dockerActions) {
      expect(a.urlRequest?.useLoader).toBe(false);
      expect(a.urlRequest?.responseActionName).toBe(a.actionName.replace('_REQUEST', '_RESPONSE'));
      expect(a.urlRequest?.errorActionName).toBe(a.actionName.replace('_REQUEST', '_ERROR'));
    }
  });
  it('gets all four read contracts, encodes project exactly, preserves nulls and future fields', () => {
    const service = TestBed.inject(DockerService);
    for (const [request, path, data] of [
      [service.list(), '/containers', inventory],
      [service.version(), '/compose/version', { version: 'future', extra: null }],
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
  it('drains abandoned inspect channel before reusing it and ignores old-session results', () => {
    const service = TestBed.inject(DockerService),
      next = vi.fn(),
      error = vi.fn(),
      fresh = vi.fn();
    const sub = service.inspect('first').subscribe(next);
    const first = http.expectOne(`${base}/compose/projects/inspect?project=first`);
    sub.unsubscribe();
    service.inspect('second').subscribe({ error });
    expect(error.mock.calls[0][0]).toBeInstanceOf(ChannelBusyError);
    http.expectNone(`${base}/compose/projects/inspect?project=second`);
    TestBed.inject(ThemeIdentity).begin();
    service.inspect('second').subscribe(fresh);
    const second = http.expectOne(`${base}/compose/projects/inspect?project=second`);
    first.flush(project);
    expect(next).not.toHaveBeenCalled();
    expect(fresh).not.toHaveBeenCalled();
    second.flush({ ...project, name: 'second' });
    expect(fresh).toHaveBeenCalledWith({ ...project, name: 'second' });
  });
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
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
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
  it('opens complete interpreted inventory JSON locally despite filters and retains extra fields and precision warnings', () => {
    const f = initial(),
      state = f.componentInstance.state;
    state.refreshContainers();
    const data = { ...inventory, extra: null, count: 9007199254740992 };
    http.expectOne(`${base}/containers`).flush(data);
    state.search.set('no match');
    state.activity.set('online');
    const v = view(f, 'containers');
    const root = v.location.nativeElement as HTMLElement;
    const trigger = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent === 'Ver JSON del inventario',
    )!;
    trigger.click();
    v.changeDetectorRef.detectChanges();
    const host = root.querySelector('app-side-panel')!;
    const panel = getDebugNode(host)!.injector.get(SidePanel);
    expect(panel.open()).toBe(true);
    expect(panel.title()).toBe('JSON del inventario');
    expect(panel.fallbackFocus()).toBe(root.querySelector('h1'));
    expect(root.querySelectorAll('app-side-panel')).toHaveLength(1);
    expect(root.querySelector('.inventory-panel > details')).toBeNull();
    expect(host.querySelector('summary')!.textContent).toBe('JSON interpretado');
    expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(data);
    expect(host.textContent).toContain('no representan el JSON original exacto');
    expect(host.textContent).toContain('Precisión limitada');
    expect(host.querySelector('img')).toBeNull();
    expect(state.visibleContainers()).toEqual([]);
    http.expectNone(() => true);
  });
  it('updates inventory JSON during refresh, retains stale data on failure and displays an empty response with zeros', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'containers');
    state.openInventory();
    state.refreshContainers();
    v.changeDetectorRef.detectChanges();
    const host = v.location.nativeElement.querySelector('app-side-panel');
    expect(host.textContent).toContain('Actualizando inventario');
    expect(JSON.parse(host.querySelector('pre').textContent)).toEqual(inventory);
    http.expectOne(`${base}/containers`).flush({ detail: { code: 'core_unavailable' } }, fail);
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain('Error de inventario');
    expect(host.textContent).toContain('Inventario anterior, desactualizado');
    expect(JSON.parse(host.querySelector('pre').textContent)).toEqual(inventory);
    state.refreshContainers();
    const empty = { total: 0, running: 0, containers: [], future: null };
    http.expectOne(`${base}/containers`).flush(empty);
    v.changeDetectorRef.detectChanges();
    expect(JSON.parse(host.querySelector('pre').textContent)).toEqual(empty);
    expect(host.textContent).not.toContain('desactualizado');
    expect(host.textContent).not.toContain('Error de inventario');
  });
  it.each(['close', 'version', 'container', 'tab', 'leave', 'session'] as const)(
    'does not reopen inventory JSON or replace another panel after a late refresh on %s',
    (mode) => {
      const f = initial(),
        state = f.componentInstance.state;
      const v = view(f, 'containers');
      state.openInventory();
      v.changeDetectorRef.detectChanges();
      state.refreshContainers();
      const request = http.expectOne(`${base}/containers`);
      if (mode === 'close') {
        getDebugNode(v.location.nativeElement.querySelector('app-side-panel'))!
          .injector.get(SidePanel)
          .closed.emit();
      } else if (mode === 'version') state.openVersion('containers');
      else if (mode === 'container') state.openContainer(container.id, 'inventory');
      else if (mode === 'tab') state.leaveTab();
      else if (mode === 'leave') state.ionViewWillLeave();
      else TestBed.inject(ThemeIdentity).begin();
      request.flush(inventory);
      v.changeDetectorRef.detectChanges();
      expect(state.inventoryPanelOpen()).toBe(false);
      if (mode === 'version' || mode === 'container') {
        const panel = getDebugNode(
          v.location.nativeElement.querySelector('app-side-panel'),
        )!.injector.get(SidePanel);
        expect(panel.open()).toBe(true);
        expect(panel.title()).toBe(
          mode === 'version' ? 'Docker Compose' : 'Inspeccionar contenedor',
        );
      } else expect(v.instance.panelOpen()).toBe(false);
    },
  );
  it('replaces inventory JSON with project inspection and keeps the cached containers panel closed', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const containers = view(f, 'containers');
    const projects = view(f, 'projects');
    state.openInventory();
    expect(containers.instance.panelOpen()).toBe(true);
    expect(projects.instance.panelOpen()).toBe(false);
    state.inspect(project.name);
    expect(state.inventoryPanelOpen()).toBe(false);
    expect(containers.instance.panelOpen()).toBe(false);
    expect(projects.instance.panelOpen()).toBe(true);
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
  });
  it('opens the existing version reading without a request and keeps refresh failures independent', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const projectsView = view(f, 'projects');
    const containersView = view(f, 'containers');
    const strip = projectsView.location.nativeElement.querySelector('app-docker-compose-version');
    const buttons = strip.querySelectorAll('button');
    expect(strip.textContent).toContain('v2');
    buttons[0].click();
    projectsView.changeDetectorRef.detectChanges();
    expect(state.versionPanelOpen()).toBe('projects');
    http.expectNone(`${base}/compose/version`);
    state.leaveTab();
    expect(state.versionPanelOpen()).toBeNull();
    containersView.location.nativeElement
      .querySelector('app-docker-compose-version button')
      .click();
    expect(state.versionPanelOpen()).toBe('containers');
    state.refreshVersion();
    http.expectOne(`${base}/compose/version`).flush({ detail: { code: 'core_unavailable' } }, fail);
    expect(state.version.data()).toEqual({ version: 'v2' });
    expect(state.version.stale()).toBe(true);
    expect(state.inventory.data()).toEqual(inventory);
    expect(state.projects.data()).toEqual([project]);
    projectsView.changeDetectorRef.detectChanges();
    expect(strip.textContent).toContain('desactualizada');
    state.refreshVersion();
    http
      .expectOne(`${base}/compose/version`)
      .flush({ version: 'v3', extra: null, count: 9007199254740992 });
    containersView.changeDetectorRef.detectChanges();
    expect(state.version.stale()).toBe(false);
    const panel = containersView.location.nativeElement.querySelector('app-side-panel');
    const panelComponent = getDebugNode(panel)!.injector.get(SidePanel);
    expect(panelComponent.open()).toBe(true);
    expect(panel.textContent).toContain('v3');
    expect(panel.textContent).toContain('JSON interpretado');
    expect(panel.textContent).toContain('"extra": null');
    expect(panel.textContent).toContain('Precisión limitada');
    panelComponent.closed.emit();
    expect(state.versionPanelOpen()).toBeNull();
    state.versionPanelOpen.set('containers');
    state.ionViewWillLeave();
    expect(state.versionPanelOpen()).toBeNull();
  });
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
    expect(panel.fallbackFocus()).toBe(root.querySelector('h1'));
    expect(state.currentContainer()).toEqual(container);
    expect(root.querySelectorAll('.action-buttons button')).toHaveLength(4);
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
  it('keeps Compose data separate from current inventory and replaces panel contents without requests', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'projects');
    const observed = { ...container, name: 'Compose old copy', online: true };
    state.projects.data.set([{ ...project, services: [{ name: null, containers: [observed] }] }]);
    state.openVersion('projects');
    v.changeDetectorRef.detectChanges();
    v.location.nativeElement.querySelector('.inspect-container').click();
    v.changeDetectorRef.detectChanges();
    expect(state.versionPanelOpen()).toBeNull();
    expect(state.currentContainer()).toEqual(observed);
    expect(state.containerInInventory()).toEqual(container);
    expect(v.location.nativeElement.querySelectorAll('app-side-panel')).toHaveLength(1);
    state.inventory.data.set({ ...inventory, containers: [] });
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.querySelector('app-side-panel').textContent).toContain(
      'Sin el mismo ID',
    );
    expect(state.currentContainer()).toEqual(observed);
    state.openVersion('projects');
    expect(state.inspectedContainer()).toBeNull();
    http.expectNone(() => true);
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
  it('preserves complete container details, empty collections and invalid dates while formatting valid dates in UTC', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const value = {
      ...container,
      started_at: '2026-10-29T12:00:00+02:00',
      finished_at: 'invalid-date',
      ports: [],
      networks: [],
      exit_code: 137,
    };
    state.inventory.data.set({ ...inventory, containers: [value] });
    state.openContainer(container.id, 'inventory');
    const v = view(f, 'containers');
    const details = v.location.nativeElement.querySelector('app-container-details');
    expect(details.textContent).toContain('2026-10-29 10:00:00.000 UTC');
    expect(details.textContent).toContain('invalid-date');
    expect(details.textContent).toContain('Sin puertos');
    expect(details.textContent).toContain('Sin redes');
    expect(details.textContent).toContain('Salida: 137');
    expect(details.textContent).toContain('future-status');
    expect(details.textContent).toContain('JSON interpretado');
    expect(JSON.parse(details.querySelector('pre').textContent)).toEqual(value);
    expect(details.querySelector('img')).toBeNull();
    state.inventory.data.set(inventory);
    v.changeDetectorRef.detectChanges();
    expect(details.textContent).toContain('Inicio: No disponible');
    expect(details.textContent).toContain('Puerta de enlace:');
    expect(details.textContent).toContain('MAC:');
    for (const invalid of [
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-04-31T12:00:00+02:00',
    ]) {
      state.inventory.data.set({
        ...inventory,
        containers: [{ ...container, started_at: invalid }],
      });
      v.changeDetectorRef.detectChanges();
      expect(details.textContent).toContain('Inicio: ' + invalid);
    }
    state.inventory.data.set({
      ...inventory,
      containers: [{ ...container, started_at: '2024-02-29T12:00:00Z' }],
    });
    v.changeDetectorRef.detectChanges();
    expect(details.textContent).toContain('2024-02-29 12:00:00.000 UTC');
    const sections = Array.from(details.querySelectorAll('h3, summary')).map(
      (node: any) => node.textContent,
    );
    expect(sections.slice(-2)).toEqual(['Operaciones', 'JSON interpretado']);
  });
  it('shows project inspection loading, totals and full JSON in the shared panel and retains the list JSON', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'projects');
    const root = v.location.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('app-docker-project-card footer button')!.click();
    v.changeDetectorRef.detectChanges();
    const host = root.querySelector('app-side-panel')!;
    const panel = getDebugNode(host)!.injector.get(SidePanel);
    expect(panel.open()).toBe(true);
    expect(panel.title()).toBe('Inspeccionar proyecto');
    expect(host.textContent).toContain('Inspeccionando proyecto');
    state.inspect(project.name);
    const response = {
      ...project,
      extra: { preserved: null },
      services: [
        {
          name: null,
          containers: [container, { ...container, id: 'online', online: true, status: 'future' }],
        },
        { name: 'empty', containers: [] },
      ],
    };
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(response);
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).toContain(project.name);
    expect(host.textContent).toContain('2 servicios · 2 contenedores · 1 en ejecución');
    expect(host.textContent).toContain('no acredita propiedad');
    expect(host.textContent).toContain('Sin nombre');
    expect(host.textContent).toContain('Sin contenedores');
    expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(response);
    const listJson = Array.from(root.querySelectorAll('section details')).find((details) =>
      details.querySelector('summary')?.textContent?.includes('Datos de proyectos'),
    )!;
    expect(JSON.parse(listJson.querySelector('pre')!.textContent!)).toEqual([project]);
    expect(root.querySelectorAll('app-side-panel')).toHaveLength(1);
    expect(root.querySelector('section > h3')).toBeNull();
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
    expect(host.querySelector('pre')).not.toBeNull();
    state.inspect('second');
    state.inspect(project.name);
    http.expectNone(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`);
    v.changeDetectorRef.detectChanges();
    expect(host.textContent).not.toContain(project.name);
    expect(host.querySelector('pre')).toBeNull();
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
  it.each(['close', 'version', 'container', 'tab', 'session'] as const)(
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
      else if (mode === 'version') state.openVersion('projects');
      else if (mode === 'container') state.openContainer(container.id, 'projects', project.name);
      else if (mode === 'tab') state.leaveTab();
      else TestBed.inject(ThemeIdentity).begin();
      if (!request.cancelled) request.flush(project);
      v.changeDetectorRef.detectChanges();
      expect(state.projectPanelOpen()).toBeNull();
      if (mode === 'version') {
        expect(state.versionPanelOpen()).toBe('projects');
        expect(v.location.nativeElement.querySelector('app-side-panel h3').textContent).toContain(
          'Versión detectada',
        );
      } else if (mode === 'container') {
        expect(state.currentContainer()).toEqual(container);
        expect(v.location.nativeElement.querySelector('app-container-details')).not.toBeNull();
      } else expect(v.instance.panelOpen()).toBe(false);
    },
  );
  it('shows unavailable project after a successful list refresh and ignores its late response', () => {
    const f = initial(),
      state = f.componentInstance.state;
    const v = view(f, 'projects');
    state.inspect(project.name);
    const request = http.expectOne(
      `${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`,
    );
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([]);
    request.flush(project);
    v.changeDetectorRef.detectChanges();
    expect(state.selected()).toBeNull();
    expect(state.detail.data()).toBeNull();
    expect(v.instance.panelOpen()).toBe(true);
    const host = v.location.nativeElement.querySelector('app-side-panel');
    expect(host.textContent).toContain('Proyecto no disponible en esta lectura');
    expect(host.querySelector('pre')).toBeNull();
    v.instance.closePanel();
    expect(v.instance.panelOpen()).toBe(false);
  });
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
  it('shows independent indicators for missing, zero, stale and differing readings in both tabs', () => {
    const f = enter(),
      state = f.componentInstance.state;
    const v = view(f, 'projects');
    const indicators = () =>
      Array.from(v.location.nativeElement.querySelectorAll('.indicator')).map(
        (element: any) => element.textContent as string,
      );
    expect(indicators().every((text) => text.includes('Desconocido'))).toBe(true);
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http
      .expectOne(`${base}/compose/projects`)
      .flush([
        project,
        { ...project, name: 'second', services: [...project.services, ...project.services] },
      ]);
    v.changeDetectorRef.detectChanges();
    expect(indicators()).toEqual([
      'Contenedores99',
      'En ejecución0de 99 contenedores',
      'Proyectos2',
      'Servicios3',
    ]);
    expect(
      view(f, 'containers').location.nativeElement.querySelectorAll('.indicator'),
    ).toHaveLength(4);
    state.refreshProjects();
    http
      .expectOne(`${base}/compose/projects`)
      .flush({ detail: { code: 'core_unavailable' } }, fail);
    v.changeDetectorRef.detectChanges();
    expect(indicators()[0]).not.toContain('desactualizada');
    expect(indicators()[2]).toContain('2');
    expect(indicators()[2]).toContain('desactualizada');
    expect(indicators()[3]).toContain('desactualizada');
    state.refreshContainers();
    http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([]);
    v.changeDetectorRef.detectChanges();
    expect(indicators().every((text) => text.includes('0'))).toBe(true);
    expect(indicators().every((text) => !text.includes('desactualizada'))).toBe(true);
  });
  it('renders project card totals from Compose and retains inspection and stale data', () => {
    const f = enter(),
      state = f.componentInstance.state;
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush([
      {
        ...project,
        services: [
          {
            name: null,
            containers: [
              { ...container, online: true },
              { ...container, id: 'offline' },
            ],
          },
        ],
      },
      { name: 'empty', services: [] },
    ]);
    const v = view(f, 'projects');
    const cards = v.location.nativeElement.querySelectorAll('app-docker-project-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('1 / 2 activos');
    expect(cards[0].textContent).toContain('1 servicio · 2 contenedores');
    expect(cards[0].textContent).toContain('Sin nombre');
    expect(cards[0].querySelector('[role="progressbar"]').getAttribute('aria-valuetext')).toBe(
      '1 de 2 activos',
    );
    expect(cards[1].textContent).toContain('0 / 0 activos');
    expect(cards[1].querySelector('[role="progressbar"] span').style.width).toBe('0%');
    cards[0].querySelector('footer button').click();
    http
      .expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`)
      .flush(project);
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.textContent).toContain('Inspección: ' + project.name);
    state.refreshProjects();
    http
      .expectOne(`${base}/compose/projects`)
      .flush({ detail: { code: 'core_unavailable' } }, fail);
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.textContent).toContain('Proyectos anteriores, desactualizados');
    expect(v.location.nativeElement.querySelectorAll('app-docker-project-card')).toHaveLength(2);
  });
  it('retains service expansion across refresh and tabs, and inspects Compose containers locally', () => {
    const f = enter(),
      state = f.componentInstance.state;
    const services = [
      { name: null, containers: [container] },
      { name: 'web', containers: [{ ...container, id: 'second', online: true }] },
      { name: 'web', containers: [] },
    ];
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush([{ ...project, services }]);
    const v = view(f, 'projects');
    const card = v.location.nativeElement.querySelector('app-docker-project-card');
    const group = card.querySelector('ion-accordion-group');
    const keys = Array.from(card.querySelectorAll('ion-accordion')).map(
      (item: any) => item.value as string,
    );
    expect(new Set(keys).size).toBe(3);
    expect(group.value).toEqual([keys[0]]);
    expect(card.textContent).toContain('Sin nombre');
    expect(card.textContent).toContain('1 / 1 activos');
    group.dispatchEvent(new CustomEvent('ionChange', { detail: { value: [keys[1], keys[2]] } }));
    state.leaveTab();
    state.refreshProjects();
    http
      .expectOne(`${base}/compose/projects`)
      .flush([{ ...project, services: [services[1], services[2], services[0]] }]);
    v.changeDetectorRef.detectChanges();
    expect(group.value).toEqual([keys[1], keys[2]]);
    const button = card.querySelector('.inspect-container');
    button.click();
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.querySelector('app-container-details')?.textContent).toContain(
      'ID: second',
    );
    http.expectNone(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([
      {
        ...project,
        services: [
          { ...services[1], containers: [container, services[1].containers[0]] },
          services[2],
          services[0],
        ],
      },
    ]);
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.querySelector('app-container-details')?.textContent).toContain(
      'ID: second',
    );
    state.leaveTab();
    v.changeDetectorRef.detectChanges();
    expect(state.inspectedContainer()).toBeNull();
    state.openContainer('second', 'projects', project.name);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([{ ...project, services: [services[0]] }]);
    expect(state.inspectedContainer()?.id).toBe('second');
    expect(state.currentContainer()).toBeNull();
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.textContent).toContain(
      'Contenedor no disponible en esta lectura',
    );
    state.ionViewWillLeave();
    expect(state.expandedServices()).toEqual({});
  });
  it('opens the first service when an initially empty project receives services', () => {
    const f = enter(),
      state = f.componentInstance.state;
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush([{ ...project, services: [] }]);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([project]);
    const v = view(f, 'projects');
    const group = v.location.nativeElement.querySelector('ion-accordion-group');
    expect(group.value).toHaveLength(1);
    group.dispatchEvent(new CustomEvent('ionChange', { detail: { value: [] } }));
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([project]);
    expect(state.expandedServices()[project.name]).toEqual([]);
  });
  it('keeps initial failures separate from empty data and permits independent refresh', () => {
    const f = enter(),
      v = f.componentInstance.state;
    v.prepare('start', container);
    http.expectNone(`${base}/containers/start`);
    http.expectOne(`${base}/containers`).flush({ detail: { code: 'core_unavailable' } }, fail);
    http.expectOne(`${base}/compose/version`).flush({ detail: { code: 'core_unavailable' } }, fail);
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
    expect(v.version.error()).not.toBe('');
  });
  it('renders associations independently from inventory, including unavailable and stale readings', () => {
    const f = enter(),
      state = f.componentInstance.state;
    http.expectOne(`${base}/containers`).flush({
      ...inventory,
      containers: [container, { ...container, id: 'unrelated', name: 'unrelated' }],
    });
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    const v = view(f, 'containers');
    expect(v.location.nativeElement.textContent).toContain('Asociación no disponible');
    http.expectOne(`${base}/compose/projects`).flush([project]);
    v.changeDetectorRef.detectChanges();
    const rows = v.location.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Sin nombre / ' + project.name);
    expect(rows[1].textContent).toContain('Sin asociación Compose observada');
    expect(rows[0].querySelectorAll('.action-buttons button')).toHaveLength(4);
    state.refreshProjects();
    http
      .expectOne(`${base}/compose/projects`)
      .flush({ detail: { code: 'core_unavailable' } }, fail);
    v.changeDetectorRef.detectChanges();
    expect(rows[0].textContent).toContain('Lectura de proyectos desactualizada');
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([project, { ...project, name: 'other' }]);
    v.changeDetectorRef.detectChanges();
    expect(rows[0].textContent).toContain('Asociación ambigua');
    expect(rows[0].textContent).not.toContain('Sin nombre / ' + project.name);
    expect(v.location.nativeElement.textContent).toContain('2 contenedores recibidos');
    expect(v.location.nativeElement.textContent).toContain(
      'El código de salida 137 no establece por sí solo la causa',
    );
  });
  it('searches local inventory and known Compose associations without changing source readings', () => {
    const f = enter(),
      state = f.componentInstance.state;
    const first = { ...container, id: 'full-id-alpha', name: 'Nombre Alpha', image: 'Image:ONE' };
    const second = { ...container, id: 'full-id-beta', name: 'Nombre Beta', image: 'Image:TWO' };
    const data = { total: 99, running: 0, containers: [first, second], future: 'preserved' };
    const compose = [
      { name: 'Proyecto Especial', services: [{ name: 'Servicio Web', containers: [first] }] },
    ];
    http.expectOne(`${base}/containers`).flush(data);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush(compose);
    const v = view(f, 'containers');
    const root = v.location.nativeElement;
    const input = root.querySelector('#docker-search') as HTMLInputElement;
    const search = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      v.changeDetectorRef.detectChanges();
    };
    for (const query of [
      '  ALPHA  ',
      'FULL-ID-ALPHA',
      'image:one',
      'PROYECTO ESPECIAL',
      'servicio web',
    ]) {
      search(query);
      expect(root.querySelectorAll('tbody tr:not(.row-hidden)')).toHaveLength(1);
      expect(root.querySelector('tbody tr:not(.row-hidden)').textContent).toContain(first.name);
      expect(root.textContent).toContain('1 resultado');
    }
    expect(state.inventory.data()).toEqual(data);
    expect(state.projects.data()).toEqual(compose);
    expect(root.querySelector('app-docker-indicators').textContent).toContain('99');
    state.openInventory();
    v.changeDetectorRef.detectChanges();
    expect(root.querySelector('app-side-panel pre').textContent).toContain('preserved');
    expect(root.querySelector('app-side-panel pre').textContent).toContain('full-id-beta');
    state.leaveTab();
    expect(state.search()).toBe('servicio web');
    search('no coincide');
    expect(root.textContent).toContain('No hay contenedores que coincidan con la búsqueda');
    expect(root.textContent).not.toContain('No hay contenedores.');
    expect(Array.from(root.querySelectorAll('tbody tr')).every((row: any) => row.inert)).toBe(true);
    search('  ');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(root.querySelectorAll('tbody tr')[0].textContent).toContain(first.name);
    expect(root.querySelectorAll('tbody tr')[1].textContent).toContain(second.name);
    http.expectNone(`${base}/containers`);
    http.expectNone(`${base}/compose/projects`);
    TestBed.inject(ThemeIdentity).begin();
    expect(state.search()).toBe('');
  });
  it('combines activity based on online with search, preserving source readings and order', () => {
    const f = enter(),
      state = f.componentInstance.state;
    const first = {
      ...container,
      id: 'first',
      name: 'match first',
      online: true,
      status: 'exited',
    };
    const second = {
      ...container,
      id: 'second',
      name: 'match second',
      online: false,
      status: 'running',
    };
    const third = { ...container, id: 'third', name: 'other', online: true };
    const data = { ...inventory, containers: [first, second, third] };
    http.expectOne(`${base}/containers`).flush(data);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush([project]);
    const v = view(f, 'containers');
    const root = v.location.nativeElement as HTMLElement;
    const select = root.querySelector<HTMLSelectElement>('#docker-activity')!;
    const choose = (value: string) => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      v.changeDetectorRef.detectChanges();
    };
    expect(select.value).toBe('all');
    expect(state.visibleContainers()).toEqual([first, second, third]);
    choose('online');
    expect(state.visibleContainers()).toEqual([first, third]);
    expect(root.textContent).toContain('2 resultados');
    expect(root.querySelectorAll('tbody tr:not(.row-hidden)')).toHaveLength(2);
    state.search.set(' MATCH ');
    choose('online');
    expect(state.visibleContainers()).toEqual([first]);
    choose('offline');
    expect(state.visibleContainers()).toEqual([second]);
    expect(root.textContent).toContain('1 resultado');
    choose('all');
    expect(state.visibleContainers()).toEqual([first, second]);
    expect(state.inventory.data()).toEqual(data);
    expect(state.projects.data()).toEqual([project]);
    expect(root.querySelector('app-docker-indicators')!.textContent).toContain('99');
    state.openInventory();
    v.changeDetectorRef.detectChanges();
    expect(root.querySelector('app-side-panel pre')!.textContent).toContain('third');
    state.search.set('other');
    choose('offline');
    expect(root.textContent).toContain('0 resultados');
    expect(root.textContent).toContain('No hay contenedores que coincidan');
    expect(root.textContent).not.toContain('No hay contenedores.');
    expect(
      Array.from(root.querySelectorAll<HTMLElement>('tbody tr')).every((row) => row.inert),
    ).toBe(true);
    http.expectNone(() => true);
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
  it('recalculates search for unavailable, stale and ambiguous associations and refreshed inventories', () => {
    const f = enter(),
      state = f.componentInstance.state;
    const first = { ...container, id: 'alpha', name: 'first' };
    http.expectOne(`${base}/containers`).flush({ ...inventory, containers: [first] });
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    state.search.set('web');
    expect(state.visibleContainers()).toEqual([]);
    http
      .expectOne(`${base}/compose/projects`)
      .flush([{ name: 'project', services: [{ name: 'web', containers: [first] }] }]);
    expect(state.visibleContainers()).toEqual([first]);
    state.refreshProjects();
    http
      .expectOne(`${base}/compose/projects`)
      .flush({ detail: { code: 'core_unavailable' } }, fail);
    expect(state.projects.stale()).toBe(true);
    expect(state.visibleContainers()).toEqual([first]);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([
      { name: 'project', services: [{ name: 'web', containers: [first] }] },
      { name: 'other', services: [{ name: 'web', containers: [first] }] },
    ]);
    expect(state.visibleContainers()).toEqual([]);
    state.search.set('first');
    expect(state.visibleContainers()).toEqual([first]);
    state.refreshContainers();
    http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
    const v = view(f, 'containers');
    expect(v.location.nativeElement.textContent).toContain('No hay contenedores.');
    expect(v.location.nativeElement.textContent).not.toContain('coincidan con la búsqueda');
    state.ionViewWillLeave();
    expect(state.search()).toBe('');
  });
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
    expect(rendered.querySelectorAll('.container-list button:disabled')).toHaveLength(0);
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
  it('keeps readings and a submitted write across tab changes while clearing confirmation and inspection', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.prepare('delete', container);
    v.leaveTab();
    expect(v.pending()).toBeNull();
    v.confirm();
    http.expectNone(`${base}/containers/delete`);
    v.prepare('start', container);
    const write = http.expectOne(`${base}/containers/start`);
    v.leaveTab();
    expect(v.busy()).toBe(true);
    expect(v.inventory.data()).toEqual(inventory);
    write.flush({ container: container.id, status: 'started' });
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/projects`).flush([project]);
    expect(v.result()?.status).toBe('started');
    expect(v.busy()).toBe(false);
    v.ionViewWillEnter();
    http.expectNone(`${base}/containers`);
    http.expectNone(`${base}/compose/version`);
    http.expectNone(`${base}/compose/projects`);
  });
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
