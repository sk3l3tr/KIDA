# Apagado semanal y encendido RTC mediante CLI

[English](../../en/cli/weekly-power-cycle.md) · [Índice](../000-index.md)

Apaga a las 22:00 de domingo, lunes, miércoles y jueves; enciende a las 05:00 del día siguiente.
El servidor debe usar `Europe/Madrid` y estar activo a las 21:55 esos días.
Revisa antes los [requisitos RTC](../006-system-control.md#apagado-con-encendido-rtc) y comprueba el encendido en tu hardware.

## 1. Consultar RTC

```bash
kida system wake-capabilities
```

## 2. Registrar

```bash
kida scheduler add \
  --command system.power_cycle \
  --params '{"shutdown_time":"22:00","wake_time":"05:00"}' \
  --cron '55 21 * * SUN,MON,WED,THU' \
  --timezone Europe/Madrid
```

Guarda el ID devuelto.
La tarea se envía a las 21:55 para dejar cinco minutos de margen hasta el apagado solicitado.
Repetir el alta crea otra programación.

## 3. Comprobar

```bash
kida scheduler list
```

Verifica ID, comando, parámetros, cron y zona. `Next enqueue attempt` / `next_enqueue_at` está en UTC;
su equivalencia local depende de la fecha y el cambio horario. Es un intento pendiente, no una alarma ya programada.

## 4. Eliminar

Sustituye `SCHEDULE_UUID` por el ID guardado:

```bash
kida scheduler delete --id SCHEDULE_UUID
```

Vuelve a listar para confirmar. El borrado evita futuros envíos, pero no cancela trabajo ya admitido,
ni revierte apagados solicitados ni borra alarmas RTC.
