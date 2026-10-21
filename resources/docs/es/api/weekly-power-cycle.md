# Apagado semanal y encendido RTC mediante API

[English](../../en/api/weekly-power-cycle.md) · [Índice](../000-index.md)

Apaga a las 22:00 de domingo, lunes, miércoles y jueves; enciende a las 05:00 del día siguiente.
El servidor debe usar `Europe/Madrid` y estar activo a las 21:55 esos días.
Revisa antes los [requisitos RTC](../006-system-control.md#apagado-con-encendido-rtc) y comprueba el encendido en tu hardware.

## 1. Consultar RTC

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"rtc","command":"system.wake_capabilities","params":{}}'
```

## 2. Registrar

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"weekly","command":"scheduler.add","params":{"command":"system.power_cycle","params":{"shutdown_time":"22:00","wake_time":"05:00"},"schedule":{"type":"cron","expression":"55 21 * * SUN,MON,WED,THU","timezone":"Europe/Madrid"}}}'
```

Comprueba `status: "OK"` y guarda `data.id`, el UUID de la programación. Adapta el endpoint si lo has cambiado.
La tarea se envía a las 21:55 para dejar cinco minutos de margen hasta el apagado solicitado.
Repetir el alta crea otra programación.

## 3. Comprobar

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"list","command":"scheduler.list","params":{}}'
```

Verifica ID, comando, parámetros, cron y zona. `Next enqueue attempt` / `next_enqueue_at` está en UTC;
su equivalencia local depende de la fecha y el cambio horario. Es un intento pendiente, no una alarma ya programada.

## 4. Eliminar

Sustituye `SCHEDULE_UUID` por el ID guardado:

```bash
curl -sS http://127.0.0.1:8989/command \
  -H 'Content-Type: application/json' \
  --data '{"id":"delete","command":"scheduler.delete","params":{"id":"SCHEDULE_UUID"}}'
```

Vuelve a listar para confirmar. El borrado evita futuros envíos, pero no cancela trabajo ya admitido,
ni revierte apagados solicitados ni borra alarmas RTC.
