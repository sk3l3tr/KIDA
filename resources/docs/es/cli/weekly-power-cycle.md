# Apagado semanal y encendido RTC mediante CLI

[English](../../en/cli/weekly-power-cycle.md) · [Índice de documentación](../000-index.md)

Programa el apagado de un servidor a las 22:00 y el encendido a las 05:00 del día siguiente:

| Día de apagado | Día de encendido |
| --- | --- |
| Domingo | Lunes |
| Lunes | Martes |
| Miércoles | Jueves |
| Jueves | Viernes |

Es apagado seguido de encendido RTC, no `system.reboot`.
La zona local de CORE debe ser `Europe/Madrid`, igual que cron, porque las horas de apagado/encendido usan
la zona del servidor. CORE debe funcionar a las 21:55 los días de apagado.
El equipo y firmware deben admitir encendido RTC desde apagado y CORE necesita `rtcwake`, acceso al RTC y permisos de apagado.
El registro no verifica encendido físico; compruébalo aparte en el hardware de destino.

## 1. Comprobar requisitos y RTC

Comprueba [instalación y estado del servicio](../001-installation.md) y la zona del servidor antes de continuar.
Usa una cuenta con acceso al socket; ejecuta `kida` con `sudo` si los permisos lo exigen.
Elevar CLI no cambia los privilegios del servicio CORE.

```bash
kida system wake-capabilities
```

La consulta no modifica alarmas.

## 2. Registrar una programación semanal

```bash
kida scheduler add \
  --command system.power_cycle \
  --params '{"shutdown_time":"22:00","wake_time":"05:00"}' \
  --cron '55 21 * * SUN,MON,WED,THU' \
  --timezone Europe/Madrid
```

Guarda el ID devuelto.

## 3. Comprobar la tarea registrada

```bash
kida scheduler list
```

Cron se ejecuta a las 21:55 para dejar cinco minutos hasta el apagado. Cada ejecución programa y verifica
la alarma de las 05:00 y después solicita apagar a las 22:00. Ese margen permite respetar los 60 segundos
mínimos antes del apagado y la comprobación tras programar RTC. Un fallo programando/verificando la alarma impide solicitar el apagado.

Comprueba comando, parámetros, cron y zona en la entrada devuelta.
`Next enqueue attempt` / `next_enqueue_at` está en UTC; conviértelo para la fecha correspondiente.
Indica un encolado pendiente, no ejecución ni una alarma o apagado ya programados.
Cron sigue los cambios de hora de Madrid; su equivalencia UTC varía.

## 4. Eliminar la programación cuando corresponda

Sustituye `<SCHEDULE_UUID>` por el ID obtenido al crear:

```bash
kida scheduler delete --id <SCHEDULE_UUID>
kida scheduler list
```

Usa el UUID devuelto para tu programación, nunca un ID histórico de ejemplo.
Repetir el alta crea otra programación; no actualiza la original.
Eliminar evita futuros encolados, pero no cancela comandos en cola/ejecutándose, revierte un apagado
ni borra una alarma RTC programada antes. Esta receta no afirma haber comprobado encendido físico
ni borrado posterior en tu equipo.
