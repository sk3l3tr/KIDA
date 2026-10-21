# Docker mediante API

[English](../../en/api/docker-management.md) · [Índice](../000-index.md)

Envía cada objeto por separado mediante [HTTP o socket](README.md).

## Contenedores

Sustituye `web` por nombre o ID. El listado incluye los detenidos.

```json
{"id":"list","command":"docker.containers.list","params":{}}
{"id":"start","command":"docker.container.start","params":{"container":"web"}}
{"id":"stop","command":"docker.container.stop","params":{"container":"web"}}
{"id":"restart","command":"docker.container.restart","params":{"container":"web"}}
{"id":"delete","command":"docker.container.delete","params":{"container":"web"}}
```

El listado devuelve `data.total`, `data.running` y `data.containers` (array).
Cada contenedor incluye `id`, `name`, `image`, `online`, `status`, `health`, `started_at`, `finished_at`,
`exit_code`, `restart_count`, `restart_policy`, `ports` y `networks`.
`health`, fechas, código de salida y política de reinicio pueden ser `null`.
Los puertos contienen `container_port`, `protocol`, `host_ip` y `host_port`;
las redes, `name`, `ip_address`, `gateway` y `mac_address`.

Consulta las [precauciones de borrado](../003-docker-management.md).

## Inventario Compose

```json
{"id":"version","command":"docker.compose.version","params":{}}
{"id":"projects","command":"docker.compose.projects.list","params":{}}
{"id":"inspect","command":"docker.compose.project.inspect","params":{"project":"my-project"}}
```

| Comando | Resultado en `data` |
| --- | --- |
| `docker.compose.version` | `{"version":"2.40.0"}` (versión de ejemplo); requiere el plugin `docker compose`, no comprueba el daemon |
| `docker.compose.projects.list` | Array de proyectos; `[]` si no hay ninguno |
| `docker.compose.project.inspect` | Un proyecto con `name` y `services`; cada servicio contiene `name` y `containers` |

El inventario necesita el daemon, pero no el plugin Compose. Solo muestra proyectos y servicios con contenedores presentes,
incluidos los detenidos; no lee archivos Compose. Cada contenedor incluye los datos del listado de contenedores.
Las réplicas se agrupan por servicio; un servicio sin nombre usa `name: null`.
Proyectos y servicios se ordenan por nombre, contenedores por ID. No hay estado agregado del proyecto.

`project` debe ser texto no vacío; se recortan espacios exteriores. Un proyecto inexistente o un fallo de Docker devuelve `ERROR`.
El nombre de proyecto solo identifica dentro del daemon consultado; no demuestra propiedad de KIDA.
