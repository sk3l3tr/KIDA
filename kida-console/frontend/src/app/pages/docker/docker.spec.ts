import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { createComponent, EnvironmentInjector, getDebugNode, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ArcaActionsService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../app.config';
import { environment } from '../../../environments/environment';
import { ThemeIdentity } from '../../../theme/integration';
import { AuthService } from '../../auth/auth.service';
import { ChannelBusyError } from '../../services/arca-request.service';
import { Observable } from 'rxjs';
import { DockerService } from './docker.service';
import { Docker } from './docker';
import { DockerView } from './docker-view';
import { SidePanel } from '../../components/side-panel/side-panel';
import { DockerContainer, ComposeProject } from './docker.models';
import { dockerActions } from './docker.actions';
import { counter, display, dockerFailure } from './docker-presentation';
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
  it('opens the existing version reading without a request and keeps refresh failures independent', () => {
    const f = initial(), state = f.componentInstance.state;
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
    containersView.location.nativeElement.querySelector('app-docker-compose-version button').click();
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
    http.expectOne(`${base}/compose/version`).flush({ version: 'v3', extra: null, count: 9007199254740992 });
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
  it('shows independent indicators for missing, zero, stale and differing readings in both tabs', () => {
    const f = enter(), state = f.componentInstance.state;
    const v = view(f, 'projects');
    const indicators = () => Array.from(v.location.nativeElement.querySelectorAll('.indicator'))
      .map((element: any) => element.textContent as string);
    expect(indicators().every((text) => text.includes('Desconocido'))).toBe(true);
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush([
      project, { ...project, name: 'second', services: [...project.services, ...project.services] },
    ]);
    v.changeDetectorRef.detectChanges();
    expect(indicators()).toEqual(['Contenedores99', 'En ejecución0de 99 contenedores', 'Proyectos2', 'Servicios3']);
    expect(view(f, 'containers').location.nativeElement.querySelectorAll('.indicator')).toHaveLength(4);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush({ detail: { code: 'core_unavailable' } }, fail);
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
    const f = enter(), state = f.componentInstance.state;
    http.expectOne(`${base}/containers`).flush(inventory);
    http.expectOne(`${base}/compose/version`).flush({ version: 'v2' });
    http.expectOne(`${base}/compose/projects`).flush([
      { ...project, services: [{ name: null, containers: [{ ...container, online: true }, { ...container, id: 'offline' }] }] },
      { name: 'empty', services: [] },
    ]);
    const v = view(f, 'projects');
    const cards = v.location.nativeElement.querySelectorAll('app-docker-project-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('1 / 2 activos');
    expect(cards[0].textContent).toContain('1 servicio · 2 contenedores');
    expect(cards[0].textContent).toContain('Sin nombre');
    expect(cards[0].querySelector('[role="progressbar"]').getAttribute('aria-valuetext')).toBe('1 de 2 activos');
    expect(cards[1].textContent).toContain('0 / 0 activos');
    expect(cards[1].querySelector('[role="progressbar"] span').style.width).toBe('0%');
    cards[0].querySelector('footer button').click();
    http.expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`).flush(project);
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.textContent).toContain('Inspección: ' + project.name);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush({ detail: { code: 'core_unavailable' } }, fail);
    v.changeDetectorRef.detectChanges();
    expect(v.location.nativeElement.textContent).toContain('Proyectos anteriores, desactualizados');
    expect(v.location.nativeElement.querySelectorAll('app-docker-project-card')).toHaveLength(2);
  });
  it('retains service expansion across refresh and tabs, and inspects Compose containers locally', () => {
    const f = enter(), state = f.componentInstance.state;
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
    const keys = Array.from(card.querySelectorAll('ion-accordion')).map((item: any) => item.value as string);
    expect(new Set(keys).size).toBe(3);
    expect(group.value).toEqual([keys[0]]);
    expect(card.textContent).toContain('Sin nombre');
    expect(card.textContent).toContain('1 / 1 activos');
    group.dispatchEvent(new CustomEvent('ionChange', { detail: { value: [keys[1], keys[2]] } }));
    state.leaveTab();
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([{ ...project, services: [services[1], services[2], services[0]] }]);
    v.changeDetectorRef.detectChanges();
    expect(group.value).toEqual([keys[1], keys[2]]);
    const button = card.querySelector('.inspect-container');
    button.click();
    v.changeDetectorRef.detectChanges();
    expect(card.querySelector('app-container-details')?.textContent).toContain('ID: second');
    http.expectNone(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`);
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([{ ...project, services: [
      { ...services[1], containers: [container, services[1].containers[0]] }, services[2], services[0],
    ] }]);
    v.changeDetectorRef.detectChanges();
    expect(card.querySelector('app-container-details')?.textContent).toContain('ID: second');
    state.leaveTab();
    v.changeDetectorRef.detectChanges();
    expect(card.querySelector('app-container-details')).toBeNull();
    state.inspectedContainer.set({ project: project.name, service: keys[1], id: 'second' });
    state.refreshProjects();
    http.expectOne(`${base}/compose/projects`).flush([{ ...project, services: [services[0]] }]);
    expect(state.inspectedContainer()).toBeNull();
    state.ionViewWillLeave();
    expect(state.expandedServices()).toEqual({});
  });
  it('opens the first service when an initially empty project receives services', () => {
    const f = enter(), state = f.componentInstance.state;
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
    expect(view(f, 'containers').location.nativeElement.textContent).not.toContain('No hay contenedores.');
    expect(view(f, 'projects').location.nativeElement.textContent).toContain('No hay proyectos Compose.');
    v.refreshContainers();
    http.expectOne(`${base}/containers`).flush({ total: 0, running: 0, containers: [] });
    f.detectChanges();
    expect(view(f, 'containers').location.nativeElement.textContent).toContain('No hay contenedores.');
    expect(v.version.error()).not.toBe('');
  });
  it('shows API totals, future states, nulls, zero, anonymous services and safe remote text', () => {
    const f = initial();
    const rendered = view(f, 'containers').location.nativeElement;
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
  it('starts directly, blocks double click and separates write success from refresh failures', () => {
    const f = initial(),
      v = f.componentInstance.state;
    v.prepare('start', container);
    v.prepare('start', container);
    expect(v.pending()).toBeNull();
    const r = http.expectOne(`${base}/containers/start`);
    r.flush({ container: 'canonical', status: 'future', extra: null });
    expect(v.busy()).toBe(true);
    http.expectOne(`${base}/containers`).flush({ detail: { code: 'core_unavailable' } }, fail);
    http
      .expectOne(`${base}/compose/projects`)
      .flush({ detail: { code: 'core_unavailable' } }, fail);
    expect(v.busy()).toBe(false);
    expect(v.result()).toEqual({ container: 'canonical', status: 'future', extra: null });
    expect(v.inventory.data()).toEqual(inventory);
    expect(v.inventory.stale()).toBe(true);
    expect(v.projects.stale()).toBe(true);
    expect(v.error()).toBe('');
    f.detectChanges();
    expect(view(f, 'projects').location.nativeElement.textContent).toContain('Acción solicitada: Arrancar');
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
    const f = initial(), v = f.componentInstance.state;
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
    const f = initial(), v = f.componentInstance.state;
    v.inspect(project.name);
    const request = http.expectOne(`${base}/compose/projects/inspect?project=${encodeURIComponent(project.name)}`);
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
