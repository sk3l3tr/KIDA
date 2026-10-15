```
888    d8P  8888888 8888888b.        d8888  v0.0.4
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
max_concurrent_jobs = 2
```

El valor predeterminado es 16 si se omite la sección o el campo. La capacidad debe ser mayor que cero; con cero, CORE devuelve un error al arrancar. El worker permite hasta `queue.max_concurrent_jobs` ejecuciones simultáneas (2 por defecto); este valor también debe ser positivo y respetar los límites de concurrencia y admisión. Los `backup.run` se ejecutan de uno en uno. Reinicia CORE para aplicar los cambios.

## Crear configuraciones de backup

`backup.config.create` recibe la configuración directamente en `params`.
CORE es independiente del modo de entrada: CLI puede leer un TOML local,
componer parámetros o usar su asistente, y envía el mismo contrato JSON.
El payload antiguo `{"file":"ruta.toml"}` se rechaza.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id": "create-backup",
    "command": "backup.config.create",
    "params": {
      "name": "daily",
      "sources": ["/etc/hosts"],
      "targets": [
        {"path": "../primary", "filesystem_uuid": "volume-id"},
        {"path": "./secondary", "required": false}
      ],
      "compression": "tar_zstd",
      "lifecycle": {
        "pre_backup": [{"command": "system.health", "params": null}],
        "post_backup": []
      },
      "schedule": {"custom": [null, 1]},
      "retention": {
        "max_age": "7d",
        "keep_last": 7,
        "protected_restore_points": ["point-a"]
      }
    }
  }'
```

`name`, `sources` y `targets` son obligatorios. Cada target exige `path`;
`required` tiene default `true` y `filesystem_uuid` es opcional. La compresión
actual es `tar_zstd` y se aplica si se omite. `lifecycle` es opcional y sus listas
`pre_backup` y `post_backup` tienen default vacío. Cada comando exige `command`;
`params` acepta JSON arbitrario y tiene default `null`.

`schedule` y `retention` son opcionales. En retention, `max_age` es una cadena
opcional, `keep_last` es un entero opcional de 0 a 4294967295 y
`protected_restore_points` es una lista de cadenas con default vacío. Los valores
JSON libres se guardan como cadenas JSON en la representación TOML persistida;
los jobs TOML antiguos siguen siendo legibles. Los tipos JSON de la API se conservan.

Una respuesta `OK` devuelve el job completo en `data`, con un UUID nuevo en
`data.id`. Las rutas de sources y targets se conservan literalmente; su existencia
se comprueba al ejecutar el backup. `schedule` solo guarda metadata: no crea una
programación. Usa `scheduler.add` para programar `backup.run` con el ID o nombre del job.

Los tres modos de CLI son:

```bash
kida backup config create -f ./backup-job.toml
kida backup config create --name daily --source /etc/hosts --target ../backups
kida backup config create
```

Consulta las [opciones y defaults de CLI](../kida-cli/README.md#create-a-backup-job).

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

Sin filtro, `scheduler.list` devuelve solo programaciones `USER`. También acepta `params: null` con ese mismo resultado. Para consultar las internas o todas, envía `{"origin":"INTERNAL"}` o `{"origin":"ALL"}` en `params`; los valores del protocolo son `USER`, `INTERNAL` y `ALL`, en mayúsculas.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"list-all-schedules","command":"scheduler.list","params":{"origin":"ALL"}}'
```

Una respuesta `OK` contiene en `data` un array con `id`, `origin`, `command`, `params`, `schedule` y `next_enqueue_at` para cada programación, en su orden almacenado. Si no hay coincidencias, devuelve `[]`. El origen de una entrada es `USER` o `INTERNAL`; `ALL` solo es un filtro. `next_enqueue_at` está en UTC e indica el vencimiento pendiente de admisión, no un inicio de ejecución garantizado. Si la cola está llena, esa fecha puede quedar en el pasado mientras se espera un reintento.

`scheduler.add` crea siempre entradas `USER`. Las entradas `INTERNAL` las gestiona CORE mediante su API interna. Los comandos públicos de alta y borrado no aceptan un campo de origen para cambiar sus permisos.

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

La respuesta `OK` devuelve la definición eliminada y garantiza que esa programación no producirá nuevos encolados. No elimina peticiones ya encoladas ni interrumpe ejecuciones. Un UUID inválido, inexistente o perteneciente a una entrada `INTERNAL` devuelve `ERROR`. El borrado público solo permite eliminar entradas `USER`. No existe `scheduler.modify`: para sustituir una programación, elimínala y crea otra mediante operaciones independientes.

### Qué ocurre al vencer o reiniciar

- Los comandos programados comparten la cola FIFO y el worker con los backups manuales. El worker limita las ejecuciones simultáneas mediante `queue.max_concurrent_jobs` (2 por defecto); los `backup.run` se ejecutan de uno en uno. Se pueden encolar nuevos vencimientos aunque una ejecución anterior siga pendiente o ejecutándose. El orden de admisión no garantiza el orden de inicio o finalización.
- Se intenta admitir primero el vencimiento más antiguo, tanto para entradas `USER` como `INTERNAL`. En caso de empate se conserva el orden almacenado. Así, las recurrencias recién vencidas no adelantan a entradas que llevan más tiempo pendientes.
- Si la cola está llena, se conserva el vencimiento pendiente y se vuelve a intentar su admisión al cabo de un segundo, medido con reloj monotónico. El temporizador comprueba periódicamente el plazo; no se garantiza un instante exacto de admisión.
- Una `once` se elimina después de admitirse en la cola. Si aún está pendiente cuando CORE se detiene y su fecha ya pasó al reiniciar, se elimina al arrancar sin ejecutarse.
- Las recurrencias conservan un único vencimiento pendiente durante la saturación. Tras admitirlo, avanzan directamente a una fecha futura manteniendo su regla y anclaje, sin ráfagas para recuperar cada repetición omitida. No se recuperan peticiones encoladas ni ejecuciones interrumpidas tras reiniciar. Admitir una petición no garantiza su ejecución ni ofrece ejecución exactamente una vez.
- Al encolar se conserva únicamente el comando y sus parámetros. Los recursos referenciados se resuelven al ejecutar; borrar una programación no cambia las peticiones ya encoladas.
- Un fallo de persistencia durante el procesamiento de vencimientos o una cola cerrada termina CORE con error; no se reintenta automáticamente desde SCHEDULER.
- SCHEDULER no ofrece historial, consulta de ejecuciones ni cancelación. El campo `schedule` de una configuración de backup no activa automáticamente una programación.

### Compatibilidad al actualizar

Actualiza CORE antes que CLI. La CLI actual exige `origin` en las respuestas del scheduler y rechaza las respuestas del CORE anterior que no lo incluyen, incluso si el alta o borrado se completó. No repitas automáticamente un alta por un error de presentación: consulta primero las programaciones existentes.

CORE lee archivos anteriores sin `origin` y trata esas entradas como `USER`. Al guardar, escribe el campo en cada entrada. El CORE anterior rechaza ese formato: conserva un respaldo antes de actualizar si necesitas poder volver a esa versión. No elimines el campo de entradas `INTERNAL` para forzar compatibilidad, porque perderían su protección de origen.

# License and trademarks
