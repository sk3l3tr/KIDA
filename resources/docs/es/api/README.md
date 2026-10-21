# API para integraciones

[English](../../en/api/README.md) · [Índice](../000-index.md)

Envía comandos JSON por HTTP o Unix socket. Las operaciones se ejecutan en el servidor KIDA.
Valores predeterminados: HTTP `127.0.0.1:8989` y socket `/tmp/kida.sock`.
Para cambiarlos y restringir el acceso, consulta [configuración](../configuration.md).

## Primera petición

Con `curl`, por HTTP:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"check","command":"system.info","params":{}}'
```

Con `socat`, por Unix socket:

```bash
printf '%s\n' '{"id":"check","command":"system.info","params":{}}' \
  | socat - UNIX-CONNECT:/tmp/kida.sock
```

HTTP usa `POST /command` y `Content-Type: application/json`.
El socket requiere un objeto JSON compacto por línea y responde con una línea por petición;
una conexión admite varias peticiones. No envíes JSON multilínea al socket.

## Petición y respuesta

| Campo de petición | Tipo y uso |
| --- | --- |
| `id` | Cadena para relacionar petición y respuesta; no es un ID de recurso ni una clave de idempotencia |
| `command` | Nombre de comando con puntos, por ejemplo `scheduler.list` |
| `params` | JSON; `null` si se omite |

Envía cada ejemplo JSON de las guías como una petición independiente.
Ejemplo sin programaciones y ejemplo de error:

```json
{"id":"list","status":"OK","data":[]}
{"id":"check","status":"ERROR","error":"Unknown command: unknown.command"}
```

Comprueba `status`, no solo el código HTTP. `data` y `error` se omiten si no existen.
HTTP rechaza JSON inválido; un mensaje inválido por socket cierra esa conexión.
La admisión asíncrona no confirma finalización. En Health, revisa además diagnóstico y limpieza aunque `status` sea `OK`.
Si se pierde una respuesta de escritura, consulta el estado antes de reintentar: el comando puede haberse ejecutado.

## Comandos por tarea

- [Docker y Compose](docker-management.md).
- [Backups y Backup Health](backups-management.md).
- [Programación de tareas](task-scheduling.md).
- [Sistema y RTC](system-control.md).
- [Receta de apagado semanal](weekly-power-cycle.md).
