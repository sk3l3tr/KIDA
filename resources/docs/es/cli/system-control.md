# Sistema mediante CLI

[English](../../en/cli/system-control.md) · [Índice](../000-index.md)

## Consultas

```bash
kida system info
kida system health
kida system wake-capabilities
```

`info` muestra sistema operativo y hardware; `health`, temperaturas y ventiladores disponibles.
`wake-capabilities` consulta RTC sin modificar alarmas.

## Apagar o reiniciar

Ejecuta solo la operación que necesites:

```bash
kida system shutdown now
kida system shutdown +15
kida system shutdown 23:30
kida system reboot now
kida system reboot +15
kida system reboot 23:30
```

Consulta los [formatos de hora y efectos](../006-system-control.md#apagado-y-reinicio).

## Apagado y encendido RTC

```bash
kida system powercicle --shutdown-time 23:30 --wake-time 06:00
kida system powercicle --wake-after-seconds 28800
kida system powercicle
```

La grafía del comando es `powercicle`. Indica `--wake-time` o `--wake-after-seconds`.
Sin opción de encendido abre un asistente, incluso si has indicado solo `--shutdown-time`;
requiere terminal interactiva. Con opción de encendido no pregunta.
`--shutdown-time HH:MM` es opcional.

Antes de ejecutar, revisa los [requisitos y márgenes RTC](../006-system-control.md#apagado-con-encendido-rtc).
La salida muestra fecha y zona del encendido y, si la indicas, del apagado.
Para automatizarlo, sigue la [receta semanal](weekly-power-cycle.md).
