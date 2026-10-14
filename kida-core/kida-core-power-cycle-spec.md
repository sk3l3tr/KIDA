# KIDA-CORE · Spec: apagado y encendido programado

**Estado:** cerrada para implementación  
**Ámbito:** KIDA-CORE. CLI y frontend fuera de alcance.

## 1. Objetivo

Permitir apagar el servidor y solicitar su encendido posterior mediante RTC, tanto mediante una llamada directa como mediante los *schedules* existentes de KIDA.

**Principio arquitectónico:** `features/system` implementa operaciones puntuales; `features/scheduler` decide **cuándo** ejecutarlas. No se crean nuevos mecanismos de recurrencia, timers, repositorios ni APIs de gestión de programaciones.

## 2. Comandos

| Comando | Acción |
|---|---|
| `system.power_cycle` | Configura la próxima alarma RTC y solicita un apagado seguro. **Nuevo**. |
| `system.wake_capabilities` | Diagnóstico no destructivo de disponibilidad de alarma RTC. **Nuevo**. |
| `system.shutdown` / `system.reboot` | Se reutilizan tal como existen. Sin cambios. |

Los comandos existentes del scheduler se encargan de **crear, listar, cancelar/desactivar y eliminar** sus programaciones. No se duplican bajo `system.*`.

## 3. Contrato de `system.power_cycle`

Se mantiene el protocolo común de `CommandRequest { id, command, params }` y `CommandResponse { id, status, data?, error? }`, con `status = OK | ERROR`.

**Solicitud, hora local del servidor:**

```json
{
  "id": "123",
  "command": "system.power_cycle",
  "params": { "wake_time": "06:00" }
}
```

**Alternativa, intervalo relativo:**

```json
{
  "id": "124",
  "command": "system.power_cycle",
  "params": { "wake_after_seconds": 28800 }
}
```

**Validación y semántica:**

- Es obligatorio indicar **exactamente uno** de `wake_time` o `wake_after_seconds`.
- `wake_time`: `HH:MM`, formato de 24 horas; significa la **próxima ocurrencia futura** de esa hora, usando la zona horaria local del servidor. El cálculo se hace al ejecutar el comando, no al crear el schedule.
- `wake_after_seconds`: entero positivo; cuenta desde la ejecución del comando.
- El encendido calculado debe distar **al menos 120 segundos** del instante de ejecución, para dar margen al apagado diferido de un minuto. En caso contrario: `ERROR`, sin apagar. Este mínimo es una **política de KIDA**, no una garantía física de encendido.
- Parámetros inválidos, adicionales desconocidos o combinaciones de ambos modos: `ERROR`.
- El instante calculado se expresa internamente como timestamp Unix (`UTC`) para invocar `rtcwake` sin ambigüedad de zona horaria. En transiciones de horario de verano, elegir la primera ocurrencia real futura; si una hora local no existe, pasar a su siguiente fecha válida.

**Ejecución en este orden:**

1. Validar entrada y calcular el instante absoluto de despertar.
2. Comprobar disponibilidad de `rtcwake`, acceso al RTC y capacidad de configurar alarmas. Si falla, registrar advertencia/error y **no apagar**.
3. Ejecutar `rtcwake -m no -t <timestamp>` (programar RTC **sin suspender**).
4. Verificar que la alarma queda activada para el instante solicitado, cuando el RTC permita leerla. Si no se puede confirmar, `ERROR` y **no apagar**.
5. Solicitar apagado **diferido un minuto**, reutilizando el comportamiento existente de `system.shutdown` para permitir responder por HTTP y UNIX socket.
6. Responder `OK` solo si se han aceptado **ambas** operaciones: alarma RTC y solicitud de apagado. `OK` **no garantiza** que el firmware encenderá efectivamente desde S5.

**Respuesta de éxito (ejemplo):**

```json
{
  "id": "123",
  "status": "OK",
  "data": {
    "wake_at": "2026-10-15T06:00:00+02:00",
    "shutdown_scheduled": true,
    "s5_wake_status": "unverified"
  }
}
```

`wake_at` es el instante resultante en zona local. `s5_wake_status: "unverified"` indica que KIDA no ha comprobado el encendido físico, no que se haya demostrado incompatible. No se introduce un procedimiento de prueba automática de S5.

**Errores:** usar `status: "ERROR"` y `error` legible. Registrar el motivo (parámetros, `rtcwake` ausente, RTC sin capacidad, permisos, alarma no confirmable o apagado no aceptado). No se crea un canal de alertas nuevo: emitir el aviso mediante el mecanismo disponible de logs/errores de KIDA. Si el sistema ya dispone de alertas, integrarlo allí.

Si el apagado falla **después** de programar el RTC, devolver `ERROR` e indicar que puede quedar una alarma activa. No ejecutar un apagado de emergencia ni borrar alarmas de terceros.

## 4. Contrato de `system.wake_capabilities`

**Solicitud:**

```json
{ "id": "125", "command": "system.wake_capabilities", "params": {} }
```

**Respuesta orientativa:**

```json
{
  "id": "125",
  "status": "OK",
  "data": {
    "rtc_device": "rtc0",
    "rtcwake_available": true,
    "rtc_alarm_available": true,
    "s5_wake_status": "unverified",
    "warnings": ["La compatibilidad de encendido desde S5 requiere una prueba física."]
  }
}
```

El diagnóstico es **solo lectura**: no programa ni sustituye alarmas RTC. La presencia de una alarma programable **no demuestra** capacidad de encendido desde apagado completo (S5). Si no se puede consultar un campo, informar como desconocido, sin inferir compatibilidad.

## 5. Scheduler y conflictos

- Las recurrencias (`once`, `interval`, etc.) pertenecen **exclusivamente** al scheduler actual, basado en `systemd.timer`.
- Un schedule ejecuta `system.power_cycle` con sus parámetros por el **ejecutor común**, igual que cualquier otro comando interno.
- No se implementa detección, prioridad ni resolución de conflictos entre schedules o alarmas RTC. **El usuario asume esa responsabilidad**: una alarma posterior puede sustituir una anterior o fallar al programarse, según el RTC/controlador.
- Cancelar/eliminar un schedule evita **futuras invocaciones**, pero **no desprograma automáticamente** una alarma RTC que ya se hubiera configurado.
- No se añade persistencia específica de `power_cycle`.

## 6. Límites y seguridad

- Se requiere la capacidad del servicio KIDA de manejar `rtcwake` y solicitar apagados al SO, respetando el mecanismo de permisos existente; no se amplían permisos de los clientes HTTP/socket.
- Si no puede configurarse o comprobarse la alarma, **no apagar**. Si solo está **sin verificar** la capacidad S5, informar con advertencia; no afirmar que el equipo encenderá.
- El apagado debe ser normal, sin opción forzada.
- No se implementa Wake-on-LAN, suspensión, hibernación, scripts arbitrarios, gestión de varios RTC ni nuevos tipos de recurrencia.

## 7. Criterios de aceptación

1. Ambos comandos funcionan por **HTTP y UNIX socket**, usando el mismo ejecutor.
2. `wake_time` y `wake_after_seconds` se validan correctamente; los horarios vencidos y los límites se manejan según la sección 3.
3. Una invocación válida configura la alarma RTC y programa el apagado; permite recibir la respuesta antes de apagar.
4. Cualquier fallo de configuración/verificación RTC impide solicitar el apagado y produce `ERROR` trazable.
5. El diagnóstico no modifica el RTC e informa expresamente que el encendido desde S5 puede no estar verificado.
6. Un schedule existente puede lanzar el comando con recurrencias soportadas por KIDA sin nueva lógica en `system`.
7. Una **prueba real de apagado S5 y encendido posterior** valida el hardware de destino. No se confunde el éxito de `rtcwake` con esta prueba.

## 8. Referencias técnicas

- [`rtcwake(8)` (util-linux): modo `no`, tiempo absoluto `-t` y limitaciones hardware](https://man7.org/linux/man-pages/man8/rtcwake.8.html).
- [`shutdown(8)` (systemd): apagado diferido `+1`](https://manpages.debian.org/experimental/systemd-sysv/shutdown.8.en.html).
- [Linux kernel: interfaz RTC `wakealarm` y semántica de alarma](https://github.com/torvalds/linux/blob/master/drivers/rtc/sysfs.c).
