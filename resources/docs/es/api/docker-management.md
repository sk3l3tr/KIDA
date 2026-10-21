# Docker mediante API

[English](../../en/api/docker-management.md) · [Índice de documentación](../000-index.md)

## Contenedores

Envía cada petición por separado mediante [HTTP o socket](README.md). Sustituye `web` por nombre o ID.
El listado incluye contenedores detenidos. Detén y verifica el destino antes de eliminar; el borrado es permanente.

```json
{"id":"list","command":"docker.containers.list","params":{}}
{"id":"start","command":"docker.container.start","params":{"container":"web"}}
{"id":"stop","command":"docker.container.stop","params":{"container":"web"}}
{"id":"restart","command":"docker.container.restart","params":{"container":"web"}}
{"id":"delete","command":"docker.container.delete","params":{"container":"web"}}
```

## Inventario Compose de solo lectura

CORE ofrece tres comandos de solo lectura, mediante HTTP o Unix socket:

```json
{"id":"compose-version","command":"docker.compose.version","params":{}}
{"id":"compose-list","command":"docker.compose.projects.list","params":{}}
{"id":"compose-inspect","command":"docker.compose.project.inspect","params":{"project":"my-project"}}
```

`docker.compose.version` ejecuta `docker compose version --short`. Devuelve
`data: {"version":"2.40.0"}` si el plugin puede ejecutarse, o `ERROR` con el
diagnóstico. Esto no comprueba la disponibilidad del daemon. Se utiliza el plugin
`docker compose`, sin fallback al ejecutable antiguo `docker-compose`.

Las consultas de inventario solo necesitan acceso al daemon mediante `docker`;
funcionan aunque el plugin Compose no esté instalado. Descubren los contenedores
mediante `com.docker.compose.project`, incluidos los detenidos, y los inspeccionan.
No leen archivos Compose: un proyecto sin contenedores presentes y los servicios
sin contenedores no aparecen.

`docker.compose.projects.list` devuelve en `data` un array (vacío si no hay
proyectos). `docker.compose.project.inspect` devuelve un único proyecto:

```json
{
  "name": "my-project",
  "services": [{ "name": "web", "containers": [] }]
}
```

El esquema anterior abrevia la lista de contenedores: cada entrada real conserva
los campos de `docker.containers.list`, incluidos `id`, `name`, `image`, `online`,
`status`, `health`, fechas, código de salida, reinicios, puertos y redes. Las
réplicas se agrupan por servicio; los contenedores sin etiqueta de servicio se
agrupan bajo `name: null`. Proyectos y servicios se ordenan por nombre, y los
contenedores por ID. No se sintetiza un estado agregado del proyecto.

`params.project` debe ser una cadena no vacía; se recortan espacios exteriores.
Un proyecto inexistente o un fallo de Docker devuelve `ERROR`, sin resultado
parcial. El nombre identifica el proyecto únicamente dentro del daemon/contexto
Docker consultado: no es un identificador global ni acredita propiedad de KIDA.

No existen comandos públicos para crear, iniciar, detener o eliminar proyectos Compose; esos métodos de lifecycle son internos.
