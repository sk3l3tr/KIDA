import { Component, input } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { DockerContainer } from './docker.models';
import { counter, display, limitedPrecision } from './docker-presentation';

@Component({
  selector: 'app-container-details',
  imports: [JsonPipe],
  template: `
    <p>Nombre: {{ container().name }} · ID: {{ container().id }}</p>
    <p>Imagen: {{ container().image }}</p>
    <p>
      Actividad: {{ container().online ? 'En línea' : 'Fuera de línea' }} · Estado:
      {{ container().status }} · Salud: {{ display(container().health) }}
    </p>
    <details>
      <summary>Detalles del contenedor {{ container().name }}</summary>
      <p>
        Inicio: {{ display(container().started_at) }} · Fin: {{ display(container().finished_at) }}
      </p>
      <p>
        Salida: {{ counter(container().exit_code) }} · Reinicios:
        {{ counter(container().restart_count) }} · Política:
        {{ display(container().restart_policy) }}
      </p>
      <h4>Puertos</h4>
      @for (port of container().ports; track $index) {
        <p>
          {{ display(port.container_port) }} / {{ port.protocol }} → {{ display(port.host_ip) }}:{{
            display(port.host_port)
          }}
        </p>
      } @empty {
        <p>Sin puertos.</p>
      }
      <h4>Redes</h4>
      @for (network of container().networks; track $index) {
        <p>
          {{ network.name }} · IP: {{ display(network.ip_address) }} · Puerta de enlace:
          {{ display(network.gateway) }} · MAC: {{ display(network.mac_address) }}
        </p>
      } @empty {
        <p>Sin redes.</p>
      }
      <p>Datos recibidos, interpretados por JavaScript (JSON).</p>
      @if (limitedPrecision(container())) {
        <p>Precisión limitada: algún valor numérico no es un entero seguro de JavaScript.</p>
      }
      <pre>{{ container() | json }}</pre>
    </details>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    p,
    summary {
      overflow-wrap: anywhere;
    }
    summary {
      cursor: pointer;
      padding: 0.75rem 0;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 22rem;
      overflow: auto;
      font-size: 0.85rem;
    }
  `,
})
export class ContainerDetails {
  readonly container = input.required<DockerContainer>();
  readonly display = display;
  readonly counter = counter;
  readonly limitedPrecision = limitedPrecision;
}
