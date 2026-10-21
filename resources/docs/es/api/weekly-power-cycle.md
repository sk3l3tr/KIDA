# Apagado semanal y encendido RTC mediante API

[English](../../en/api/weekly-power-cycle.md) · [Índice de documentación](../000-index.md)

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

Comprueba la [instalación](../001-installation.md) y la zona del servidor. Los ejemplos usan HTTP;
para Unix socket envía [el mismo JSON en una sola línea](README.md). Adapta el endpoint a la configuración de CORE.

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"check-rtc","command":"system.wake_capabilities","params":{}}'
```

La consulta no modifica alarmas. Comprueba `status` antes de continuar.

## 2. Registrar una programación semanal

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{
    "id":"weekly-power-cycle",
    "command":"scheduler.add",
    "params":{
      "command":"system.power_cycle",
      "params":{"shutdown_time":"22:00","wake_time":"05:00"},
      "schedule":{
        "type":"cron",
        "expression":"55 21 * * SUN,MON,WED,THU",
        "timezone":"Europe/Madrid"
      }
    }
  }'
```

Exige `status: "OK"` y guarda `data.id`, el UUID de la programación. El `id` exterior solo identifica la petición.

## 3. Comprobar la tarea registrada

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"check-weekly-task","command":"scheduler.list","params":{}}'
```

Cron se ejecuta a las 21:55 para dejar cinco minutos hasta el apagado. Cada ejecución programa y verifica
la alarma de las 05:00 y después solicita apagar a las 22:00. Ese margen permite respetar los 60 segundos
mínimos antes del apagado y la comprobación tras programar RTC. Un fallo programando/verificando la alarma impide solicitar el apagado.

Comprueba comando, parámetros, cron y zona en la entrada devuelta.
`Next enqueue attempt` / `next_enqueue_at` está en UTC; conviértelo para la fecha correspondiente.
Indica un encolado pendiente, no ejecución ni una alarma o apagado ya programados.
Cron sigue los cambios de hora de Madrid; su equivalencia UTC varía.

## 4. Eliminar la programación cuando corresponda

Sustituye `SCHEDULE_UUID` por el `data.id` guardado:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"remove-weekly-task","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}'
```

Comprueba `status` y vuelve a listar para confirmar el borrado.

Usa el UUID devuelto para tu programación, nunca un ID histórico de ejemplo.
Repetir el alta crea otra programación; no actualiza la original.
Eliminar evita futuros encolados, pero no cancela comandos en cola/ejecutándose, revierte un apagado
ni borra una alarma RTC programada antes. Esta receta no afirma haber comprobado encendido físico
ni borrado posterior en tu equipo.
