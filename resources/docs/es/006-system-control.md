# Control del sistema

[English](../en/006-system-control.md) · [Índice](000-index.md)

Usa la [CLI](cli/system-control.md) o la [API](api/system-control.md) para consultar hardware y sensores,
apagar, reiniciar o programar un encendido RTC. Todas las acciones afectan al servidor KIDA.

## Apagado y reinicio

`now` indica inmediato, `+N` un retraso en minutos y `HH:MM` una hora de 24 horas.
Reiniciar actúa sobre un equipo encendido; para encenderlo después de apagarlo necesitas RTC.

## Apagado con encendido RTC

Requiere `rtcwake`, permisos del servicio y hardware/firmware con encendido desde apagado (S5).
Consultar capacidades RTC no cambia alarmas ni demuestra que el equipo vaya a encenderse: pruébalo en tu hardware.

| Opción | Significado |
| --- | --- |
| Hora de encendido | Siguiente `HH:MM` en la zona local del servidor |
| Retraso de encendido | Segundos desde la ejecución, no desde el apagado; mínimo 120 |
| Hora de apagado opcional | Hoy en la zona local del servidor; al menos 60 segundos por delante |
| Sin hora de apagado | Solicita apagar en un minuto |

Indica exactamente una opción de encendido. El encendido debe quedar al menos 120 segundos después de la ejecución
y 60 segundos después del apagado. Se rechazan horas de apagado pasadas, inexistentes o ambiguas y horarios incompatibles;
no se trasladan automáticamente al día siguiente.

KIDA verifica la alarma antes de solicitar apagar. Si falla o se agota el margen, no solicita el apagado;
la alarma podría seguir activa. Los márgenes no garantizan cuánto tarda el hardware en apagarse.
Una alarma posterior puede reemplazar otra. Borrar una programación no borra la alarma ni revierte un apagado solicitado.

Receta: [apagado semanal con CLI](cli/weekly-power-cycle.md) o [API](api/weekly-power-cycle.md).
