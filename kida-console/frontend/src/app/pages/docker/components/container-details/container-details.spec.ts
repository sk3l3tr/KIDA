import { TestBed } from '@angular/core/testing';
import { ContainerDetails } from './container-details';
import { DockerContainer } from '../../utils/docker.models';

describe('ContainerDetails presentation', () => {
  it('keeps full identifiers, UTC precision, zero and unknown fields in labelled rows', () => {
    const fixture = TestBed.createComponent(ContainerDetails);
    const container: DockerContainer = {
      name: 'project-'.repeat(20),
      id: 'f'.repeat(64),
      image: 'busybox:1.37',
      online: false,
      status: 'future-status',
      health: null,
      started_at: '2026-10-29T14:55:38.516Z',
      finished_at: 'invalid-date',
      exit_code: 0,
      restart_count: 0,
      restart_policy: null,
      ports: [],
      networks: [{ name: 'network', ip_address: null, gateway: null, mac_address: null }],
    };
    fixture.componentRef.setInput('container', container);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const fields = Object.fromEntries(
      Array.from(root.querySelectorAll('dl > div'), (row) => [
        row.querySelector('dt')!.textContent,
        row.querySelector('dd')!.textContent,
      ]),
    );
    expect(fields).toMatchObject({
      'Nombre completo': container.name,
      ID: container.id,
      'Estado Docker': 'future-status',
      Inicio: '2026-10-29 14:55:38.516 UTC',
      Fin: 'invalid-date',
      'Código de salida': '0',
      Reinicios: '0',
      Salud: 'Desconocido / no disponible',
      IP: 'Desconocido / no disponible',
      'Puerta de enlace': 'Desconocido / no disponible',
      MAC: 'Desconocido / no disponible',
    });
    expect(root.textContent).toContain('Sin puertos.');
    fixture.componentRef.setInput('container', { ...container, networks: [] });
    fixture.detectChanges();
    expect(root.textContent).toContain('Sin redes.');
  });
});
