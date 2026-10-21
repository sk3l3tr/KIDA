# Instalar KIDA

[English](../en/001-installation.md) · [Índice de documentación](000-index.md)

## Requisitos

Usa Linux con systemd, permisos de administrador, `bash`, `curl`, `sha256sum` e `install`.
Los binarios publicados deben ser compatibles con la plataforma del equipo. Las operaciones Docker
necesitan Docker; Backup Health requiere también el plugin Docker Compose. El encendido RTC necesita
hardware compatible, `rtcwake` y permisos de CORE para programar la alarma y solicitar el apagado.

El [instalador](../../scripts/install.sh) actual utiliza el Forgejo privado
`http://git.atlantis.arpa`, propietario `sk3l3t0r`, paquete `kida`. Necesitas acceso de red
y, cuando corresponda, credenciales. No es un servicio público de descargas.
`KIDA_VERSION` selecciona una versión de paquete existente; `KIDA_TOKEN` es opcional si se admite
descarga anónima. Servidor, propietario y paquete están fijados en el script; no se sustituyen
mediante variables de entorno.

## 1. Descargar y revisar el instalador

Sustituye las credenciales de ejemplo por unas autorizadas para ese Forgejo.
Si el repositorio permite lectura anónima, omite `--user`.

```bash
curl -fsSL \
  --user 'YOUR_USER:YOUR_TOKEN' \
  http://git.atlantis.arpa/sk3l3t0r/kida/raw/branch/master/resources/scripts/install.sh \
  -o /tmp/kida-install.sh
```

Lee `/tmp/kida-install.sh` antes de ejecutarlo.

## 2. Instalar una versión publicada

Sustituye `RELEASE_VERSION` por la versión publicada exacta. El script necesita root.

```bash
sudo env \
  KIDA_VERSION='RELEASE_VERSION' \
  KIDA_TOKEN='YOUR_TOKEN' \
  bash /tmp/kida-install.sh
```

El instalador descarga `kida-core`, `kida-cli` y `SHA256SUMS`, comprueba los checksums,
instala `/usr/local/bin/kida-core` y `/usr/local/bin/kida`, escribe `kida.service`
y habilita e inicia el servicio. Instala CORE y CLI; no instala CONSOLE ni los requisitos
Docker/RTC. La unidad actual ejecuta el servicio como root.

## 3. Comprobar la instalación

```bash
systemctl --no-pager --full status kida
journalctl -u kida -n 50 --no-pager
kida --help
kida system info
```

El instalador muestra el estado del servicio, pero puede anunciar éxito aunque esa comprobación falle.
Comprueba el servicio y un comando de consulta. Si CLI indica permiso denegado, revisa los permisos
del socket y tu cuenta; un administrador puede realizar la comprobación con `sudo`.
CORE necesita permisos sobre sus rutas y operaciones configuradas.

Consulta la [configuración](configuration.md) antes de cambiar los endpoints. La CLI actual solo
conecta con `/tmp/kida.sock`. Los cambios de configuración requieren reiniciar CORE.
