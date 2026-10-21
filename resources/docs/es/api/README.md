# API directa: HTTP y Unix socket

[English](../../en/api/README.md) · [Índice de documentación](../000-index.md)

Envía el mismo sobre JSON por cualquiera de los transportes. Estos ejemplos realizan una consulta:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"system-check","command":"system.health","params":{}}'
```

```bash
printf '%s\n' '{"id":"system-check","command":"system.health","params":{}}' \
  | socat - UNIX-CONNECT:/tmp/kida.sock
```

Los comandos requieren `curl` o `socat`, respectivamente. Los valores predeterminados son
`127.0.0.1:8989/command` y `/tmp/kida.sock`. Consulta la [configuración](../configuration.md).
El servidor actual no aplica autenticación ni proporciona TLS. El acceso al socket depende de permisos del sistema de archivos.

## Petición y respuesta

Una petición contiene `id` y `command` de tipo cadena y `params` JSON (`null` por defecto si se omite).
El ID exterior correlaciona la respuesta; no es el ID de backup, programación o ejecución ni una clave de idempotencia.

HTTP utiliza `POST /command` y `Content-Type: application/json`. Unix socket usa un objeto JSON compacto
por línea y devuelve una línea por petición; no envíes JSON formateado en varias líneas al socket.
Una conexión admite múltiples líneas de petición.

```json
{ "id": "request-1", "command": "scheduler.list", "params": {} }
```

Ejemplo de respuesta sin programaciones:

```json
{ "id": "request-1", "status": "OK", "data": [] }
```

Ejemplo de error de comando:

```json
{
  "id": "request-1",
  "status": "ERROR",
  "error": "Unknown command: unknown.command"
}
```

Comprueba `status` y `error`, no solo el código HTTP. Los errores de comando son respuestas JSON;
HTTP rechaza JSON inválido en su capa de entrada y los mensajes inválidos de socket terminan esa conexión.
`data` y `error` se omiten cuando no existen. La admisión en cola no es finalización del trabajo.
Revisa los campos de diagnóstico y limpieza Health aunque `status` sea `OK`.
No reintentes escrituras a ciegas tras un fallo de transporte: el comando podría haberse ejecutado.

## Comandos por tarea

- [Docker](docker-management.md)
- [Backups y Backup Health](backups-management.md)
- [Scheduler](task-scheduling.md)
- [Sistema](system-control.md)
- [Apagado semanal y encendido RTC](weekly-power-cycle.md)

Los bloques con varias líneas de peticiones son ejemplos independientes: envía cada objeto por separado.
En socket, conserva cada objeto en una sola línea.
