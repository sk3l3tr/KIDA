```
888    d8P  8888888 8888888b.        d8888  v0.0.3
888   d8P     888   888  "Y88b      d88888  CORE
888  d8P      888   888    888     d88P888
888d88K       888   888    888    d88P 888
8888888b      888   888    888   d88P  888
888  Y88b     888   888    888  d88P   888
888   Y88b    888   888  .d88P d8888888888
888    Y88b 8888888 8888888P" d88P     888
```

> KIDA is the intelligent agent at the core of your server, quietly watching over the place, automating operations, and keeping everything under control.

# What is KIDA CORE

KIDA CORE ejecuta las operaciones del servidor y permite programar comandos persistentes con SCHEDULER. Puedes acceder a sus comandos mediante HTTP o Unix socket.

# Using KIDA CORE

KIDA tiene 2 formas de comunicación: HTTP y Unix socket. En ambos casos, el formato de entrada es JSON. Algunos ejemplos son:

```bash
curl -X POST http://127.0.0.1:8989/command -H 'Content-Type: application/json' -d '{"id": "1", "command": "system.health", "params": {}}'

echo '{"id": "1", "command": "system.health", "params": {}}' | socat - UNIX-CONNECT:/tmp/kida.sock
```

## Configurar la capacidad de la cola

En `/etc/kida/kida.toml`, puedes ajustar cuántos comandos pendientes admite la cola compartida por los backups manuales y SCHEDULER:

```toml
[queue]
capacity = 16
```

El valor predeterminado es 16 si se omite la sección o el campo. La capacidad debe ser mayor que cero; con cero, CORE devuelve un error al arrancar. Reinicia CORE para aplicar los cambios. La ejecución sigue a cargo de un único worker.

## Programar comandos con SCHEDULER

SCHEDULER permite programar cualquier comando registrado en KIDA CORE, incluidos `scheduler.add`, `scheduler.list` y `scheduler.delete`. Los ejemplos usan HTTP; los mismos mensajes JSON se pueden enviar por Unix socket.

La ruta del archivo de programaciones se configura en `/etc/kida/kida.toml`:

```toml
[scheduler]
path = "/etc/kida/scheduler.toml"
```

Si omites la sección o el campo, se usa `/etc/kida/scheduler.toml`. Reinicia CORE para aplicar los cambios de ruta. CORE necesita permisos para escribir en el directorio configurado. Si el archivo no existe, empieza sin programaciones; si está corrupto, CORE no arranca y no lo sobrescribe.

### Crear una programación

Envía la definición directamente en `params`, con `command`, `params` y `schedule`. Los parámetros del comando programado son obligatorios y pueden contener cualquier valor JSON, incluido `null`.

Para intentar ejecutar `health` cada 60 segundos:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-health",
    "command": "scheduler.add",
    "params": {
      "command": "health",
      "params": {},
      "schedule": {"type": "interval", "seconds": 60}
    }
  }'
```

Una respuesta `OK` devuelve en `data` la definición con su UUID en `data.id`. Guarda ese UUID para eliminarla. El `id` exterior identifica la petición, no la programación.

`interval.seconds` debe ser un entero positivo. El primer intento ocurre un intervalo después del alta; los siguientes mantienen el anclaje original incluso después de reiniciar CORE.

Para un único intento, usa `once` con una fecha futura RFC3339 y desplazamiento horario explícito (`Z` o, por ejemplo, `+02:00`). Sustituye la fecha del ejemplo por la que necesites:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-once",
    "command": "scheduler.add",
    "params": {
      "command": "health",
      "params": null,
      "schedule": {"type": "once", "at": "2027-01-15T10:00:00+01:00"}
    }
  }'
```

Para un intento diario a las 02:30 en Madrid:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "schedule-cron",
    "command": "scheduler.add",
    "params": {
      "command": "health",
      "params": {},
      "schedule": {
        "type": "cron",
        "expression": "30 2 * * *",
        "timezone": "Europe/Madrid"
      }
    }
  }'
```

CRON acepta cinco campos: minuto, hora, día del mes, mes y día de la semana. La zona debe ser IANA; si omites `timezone`, se usa `UTC`. Cuando el día del mes y el día de la semana están restringidos, basta que coincida uno de ellos. En cambios horarios, las horas locales inexistentes se omiten y cada coincidencia de una hora repetida se intenta una sola vez, en su primera aparición.

El alta valida el comando registrado y la regla temporal. Los parámetros específicos del comando y los recursos referenciados se validan al ejecutar, no al crear la programación.

### Listar y eliminar

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"list-schedules","command":"scheduler.list","params":{}}'
```

Una respuesta `OK` contiene en `data` un array con `id`, `command`, `params`, `schedule` y `next_enqueue_at` para cada programación. Si no hay ninguna, devuelve `[]`. `next_enqueue_at` está en UTC e indica el próximo intento de encolado, no un inicio de ejecución garantizado.

Para eliminar una programación, sustituye `UUID_DEVUELTO` por su UUID:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "delete-schedule",
    "command": "scheduler.delete",
    "params": {"id": "UUID_DEVUELTO"}
  }'
```

La respuesta `OK` devuelve la definición eliminada y garantiza que esa programación no producirá nuevos encolados. No elimina peticiones ya encoladas ni interrumpe ejecuciones. Un UUID inválido o inexistente devuelve `ERROR`. No existe `scheduler.modify`: para sustituir una programación, elimínala y crea otra mediante operaciones independientes.

### Qué ocurre al vencer o reiniciar

- Los comandos programados comparten la cola FIFO y el worker único con los backups manuales. Se pueden encolar nuevos vencimientos aunque una ejecución anterior siga pendiente o ejecutándose; esto no crea workers adicionales.
- Si la cola está llena, se descarta ese vencimiento sin reintentos. Las recurrencias futuras se conservan.
- Una `once` se elimina tras su único intento, incluso si la cola está llena. Si vence mientras CORE está parado, se elimina al arrancar sin ejecutarse.
- No se recuperan vencimientos perdidos, peticiones encoladas ni ejecuciones interrumpidas. Si el temporizador se retrasa, intenta una vez el vencimiento pendiente y avanza directamente a una fecha futura, sin ráfagas de recuperación.
- Al encolar se conserva únicamente el comando y sus parámetros. Los recursos referenciados se resuelven al ejecutar; borrar una programación no cambia las peticiones ya encoladas.
- Un fallo de persistencia durante el procesamiento de vencimientos o una cola cerrada termina CORE con error; no se reintenta automáticamente desde SCHEDULER.
- SCHEDULER no ofrece historial, consulta de ejecuciones ni cancelación. El campo `schedule` de una configuración de backup no activa automáticamente una programación.

# License and trademarks
