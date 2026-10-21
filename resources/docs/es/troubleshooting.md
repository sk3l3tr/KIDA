# Solución de problemas

[English](../en/troubleshooting.md) · [Índice](000-index.md)

## Consultar el servicio

```bash
systemctl --no-pager --full status kida
sudo journalctl -u kida -n 100 --no-pager
```

| Problema | Qué comprobar |
| --- | --- |
| `KIDA agent is not running.` | Estado y registro del servicio. Si está detenido, corrige el error indicado y usa `sudo systemctl start kida` |
| Permiso denegado en CLI | Prueba una consulta con `sudo kida system info`. Revisa permisos de `/tmp/kida.sock` y de tu cuenta; no abras el socket a todo el mundo |
| Servicio activo, CLI sin conexión | La CLI necesita el socket `/tmp/kida.sock`. Comprueba `unix.socket_path` en [configuración](configuration.md) |
| Error al arrancar | Revisa el TOML, permisos y la ruta señalada en el registro. No borres el archivo de programaciones ni el bloqueo del socket de una instancia activa |
| `required backup target unavailable` | El destino debe existir como directorio, estar montado si corresponde y permitir acceso al servicio |
| Error de origen o copia | Comprueba ruta en el servidor, permisos, espacio y soporte de enlaces duros en el destino |
| Cola llena o límite Health alcanzado | Espera a que termine trabajo. Revisa entornos manuales activos antes de cambiar límites |
| Health con diagnóstico negativo | Consulta `kida backup health get --run-id RUN_UUID` y su informe; revisa imagen, healthcheck y rutas Compose |
| Health con limpieza incompleta | Revisa los errores, corrige su causa y reintenta `kida backup health delete --run-id RUN_UUID`. Se conservan recursos compartidos o de propiedad no demostrada |
| Se perdió una respuesta de escritura | Lista configuraciones, programaciones o entornos antes de repetir: la operación puede haberse completado |

Sustituye `RUN_UUID` por el ID Health. Para un backup encolado, guarda el ID de ejecución y busca su resultado
[en el registro](004-backups-management.md#comprobar-una-ejecución). No existe una consulta de progreso del backup.

Que una programación figure en el listado no demuestra que se haya ejecutado.
Para RTC, consulta las [restricciones del equipo y del horario](006-system-control.md#apagado-con-encendido-rtc).
