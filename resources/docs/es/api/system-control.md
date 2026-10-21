# Sistema mediante API

[English](../../en/api/system-control.md) · [Índice](../000-index.md)

Envía cada objeto por separado mediante [HTTP o socket](README.md).

## Consultas

```json
{"id":"info","command":"system.info","params":{}}
{"id":"health","command":"system.health","params":{}}
{"id":"rtc","command":"system.wake_capabilities","params":{}}
```

`system.info` informa de sistema operativo y hardware; `system.health`, de sensores.
`system.wake_capabilities` consulta RTC sin modificar alarmas.

## Apagado y reinicio

```json
{"id":"shutdown","command":"system.shutdown","params":{"when":"+15"}}
{"id":"reboot","command":"system.reboot","params":{"when":"23:30"}}
```

`when` usa los [formatos de apagado](../006-system-control.md#apagado-y-reinicio);
si se omite o no es una cadena, se aplica `+1`.

## Apagado y encendido RTC

```json
{"id":"clock","command":"system.power_cycle","params":{"shutdown_time":"23:30","wake_time":"06:00"}}
{"id":"delay","command":"system.power_cycle","params":{"wake_after_seconds":28800}}
```

Indica exactamente uno de `wake_time` (texto `HH:MM`) y `wake_after_seconds` (entero).
`shutdown_time` es texto `HH:MM` opcional. La respuesta muestra fecha y zona del encendido y, si se indica, del apagado.
Revisa los [requisitos y márgenes RTC](../006-system-control.md#apagado-con-encendido-rtc).
Para automatizarlo, sigue la [receta semanal](weekly-power-cycle.md).
