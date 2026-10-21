# Control del sistema mediante API

[English](../../en/api/system-control.md) · [Índice de documentación](../000-index.md)

Envía cada objeto por separado mediante [HTTP o socket](README.md).

## Consultas

```json
{"id":"info","command":"system.info","params":{}}
{"id":"health","command":"system.health","params":{}}
{"id":"rtc","command":"system.wake_capabilities","params":{}}
```

`system.info` informa de sistema operativo y hardware. `system.health` consulta sensores.
`system.wake_capabilities` inspecciona RTC sin cambiar la alarma; los campos desconocidos y advertencias
son diagnóstico, no prueba de permisos ni compatibilidad de encendido S5.

## Apagado y reinicio

Estas peticiones afectan al servidor CORE. Revisa el horario antes de enviarlas.

```json
{"id":"shutdown","command":"system.shutdown","params":{"when":"+15"}}
{"id":"reboot","command":"system.reboot","params":{"when":"23:30"}}
```

`when` acepta `now`, `+N` minutos o `HH:MM` de 24 horas; los handlers usan `+1` si no reciben una cadena.
Un reinicio actúa sobre un equipo encendido; no enciende uno que ya está apagado.

## Apagado con encendido RTC

```json
{"id":"cycle-clock","command":"system.power_cycle","params":{"shutdown_time":"23:30","wake_time":"06:00"}}
{"id":"cycle-delay","command":"system.power_cycle","params":{"wake_after_seconds":28800}}
```

Indica exactamente uno de `wake_time` (siguiente `HH:MM` local) y `wake_after_seconds` (retraso entero desde
la ejecución). `shutdown_time` es opcional y corresponde a hoy en hora local; omitirlo solicita apagar en un minuto.
API no tiene asistente. El identificador público es `system.power_cycle`; CLI utiliza `powercicle`.

Consulta los [márgenes temporales y el comportamiento de alarmas](../006-system-control.md).
La respuesta informa de fecha/zona del encendido y, si se indica, del apagado.
Una respuesta correcta no demuestra encendido físico. Consulta la [receta semanal](weekly-power-cycle.md).
