# Control del sistema mediante CLI

[English](../../en/cli/system-control.md) · [Índice de documentación](../000-index.md)

## Información y salud

```bash
kida system info
kida system health
```

`info` muestra sistema operativo, hardware, CPU, memoria, discos y dispositivos gráficos.
`health` muestra salud del hardware y las lecturas disponibles de temperaturas y ventiladores.

## Apagar o reiniciar

```bash
kida system shutdown now
kida system shutdown +15
kida system shutdown 23:30
kida system reboot now
kida system reboot +15
kida system reboot 23:30
```

`now` es inmediato, `+N` indica minutos y `HH:MM` una hora de 24 horas.
Estos comandos apagan o reinician el servidor CORE. Revisa el horario antes de ejecutarlos.

## Apagar y programar encendido RTC

```bash
kida system powercicle --wake-time 06:00
kida system powercicle --wake-after-seconds 28800
kida system powercicle --shutdown-time 23:30 --wake-time 06:00
kida system powercicle
```

La grafía pública es `powercicle`. Selecciona exactamente una opción de encendido.
`--wake-time` utiliza la siguiente hora `HH:MM` en la zona local del servidor.
`--wake-after-seconds` cuenta desde la ejecución y exige al menos 120 segundos.

Sin opción de encendido, el asistente solicita el modo y el valor, incluso si has indicado
solo `--shutdown-time`. En ese caso se necesita terminal interactiva. Con opción de encendido no pregunta.

Sin `--shutdown-time` se solicita apagar en un minuto. Con `--shutdown-time HH:MM` se solicita apagar
hoy a esa hora local del servidor. Se rechazan horas pasadas, inexistentes, ambiguas y a menos de 60 segundos.
El encendido debe quedar al menos a 120 segundos de la ejecución y 60 segundos después del apagado.
Los horarios incompatibles se rechazan sin pasarlos al día siguiente. El retraso relativo cuenta desde
la ejecución, no desde el apagado.

CORE valida antes de programar la alarma, la verifica y vuelve a comprobar el margen antes de solicitar
el apagado. Si ya no es seguro, no solicita apagar y advierte de que la alarma podría seguir activa.
Los márgenes no garantizan cuánto tarda el hardware en apagarse.

La respuesta muestra fecha y zona del encendido, y las del apagado cuando se indica `--shutdown-time`.
El éxito no garantiza encendido físico desde S5; requiere prueba en el equipo de destino.

Consulta las capacidades sin cambiar alarmas:

```bash
kida system wake-capabilities
```

La salida puede contener valores desconocidos y advertencias. La disponibilidad RTC no demuestra
compatibilidad S5 ni permisos para programar. Scheduler puede invocar `system.power_cycle` con los mismos
parámetros. Una alarma posterior puede reemplazar otra; borrar la programación no borra la alarma.
