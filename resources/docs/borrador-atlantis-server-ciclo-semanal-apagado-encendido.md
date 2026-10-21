# Borrador: ciclo semanal de apagado y encendido en Atlantis Server

Ejemplo registrado en un servidor real, Atlantis Server, el 19 de octubre de 2026. Se confirmó su alta mediante `kida scheduler list`. La información
disponible no confirma todavía la ejecución del apagado, el encendido físico
mediante RTC ni la eliminación posterior de la programación.

## Objetivo

Apagar automáticamente a las 22:00 y encender a las 05:00 del día siguiente,
según este ciclo semanal:

| Apagado a las 22:00 | Encendido a las 05:00 |
| ------------------- | --------------------- |
| Domingo             | Lunes                 |
| Lunes               | Martes                |
| Miércoles           | Jueves                |
| Jueves              | Viernes               |

Aquí «encendido» significa arrancar desde apagado mediante una alarma RTC.
`system.reboot` reinicia un equipo encendido y no resuelve este ciclo nocturno.

## Condiciones

- La zona horaria local del servidor CORE debe ser `Europe/Madrid`, igual que
  la del cron: `shutdown_time` y `wake_time` usan la zona local del servidor.
- CORE debe estar funcionando a las 21:55 de los días de apagado.
- El equipo y su firmware deben permitir el encendido mediante RTC desde
  apagado completo; comprobarlo requiere una prueba física.
- CORE necesita acceso a `rtcwake`, al RTC y permisos para solicitar el apagado.

## Secuencia de comandos

Consultar las capacidades RTC sin modificar la alarma:

```bash
sudo kida system wake-capabilities
```

Registrar una sola programación para todo el ciclo semanal:

```bash
sudo kida scheduler add \
  --command system.power_cycle \
  --params '{"shutdown_time":"22:00","wake_time":"05:00"}' \
  --cron '55 21 * * SUN,MON,WED,THU' \
  --timezone Europe/Madrid
```

Cada ejecución prepara a las 21:55 la alarma RTC para las 05:00 del día
siguiente y solicita el apagado para las 22:00. Se dejan cinco minutos de
margen porque CORE exige al menos 60 segundos antes del apagado y vuelve a
comprobar el margen tras programar la alarma. Si falla la programación o
verificación de la alarma, no solicita el apagado.

Comprobar el registro:

```bash
sudo kida scheduler list
```

## Resultado observado en Atlantis Server

Salida aportada por el usuario:

```text
ID: a2a688e1-62c8-46ca-9ff2-b3106663c4d1
Origin: USER
Command: system.power_cycle
Parameters: {"shutdown_time":"22:00","wake_time":"05:00"}
Schedule: cron 55 21 * * SUN,MON,WED,THU (Europe/Madrid)
Next enqueue attempt: 2026-10-19T19:55:00+00:00
```

Ese intento de encolado está expresado en UTC: equivale al lunes 19 de octubre
de 2026 a las 21:55 en `Europe/Madrid`. El ciclo previsto era apagar el lunes
a las 22:00 y encender el martes a las 05:00.

`Next enqueue attempt` indica el siguiente intento de poner el comando en la
cola. No confirma que se haya ejecutado ni que el apagado o la alarma RTC ya
estén programados. El cron sigue la zona `Europe/Madrid`, incluidos sus cambios
de horario; la equivalencia con UTC varía según la fecha.

## Eliminar la programación

Para eliminar el registro concreto de este ejemplo:

```bash
sudo kida scheduler delete --id a2a688e1-62c8-46ca-9ff2-b3106663c4d1
sudo kida scheduler list
```

En una nueva alta se debe usar el ID que devuelva esa programación. Repetir
`scheduler add` crea otro registro; no actualiza el anterior.

La eliminación evita futuras ejecuciones de esa programación. No cancela un
comando ya encolado ni revierte el apagado o la alarma RTC que una ejecución
anterior haya programado.
