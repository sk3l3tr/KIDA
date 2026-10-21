# Instalar KIDA

[English](../en/001-installation.md) · [Índice](000-index.md)

## Requisitos

Linux con systemd, permisos de administrador y `bash`, `curl`, `sha256sum` e `install`.
Comprueba que los binarios publicados sean compatibles con tu equipo.
Para contenedores necesitas [Docker](003-docker-management.md); para encendido programado, [RTC compatible y `rtcwake`](006-system-control.md#apagado-con-encendido-rtc).

El instalador descarga desde el Forgejo privado `http://git.atlantis.arpa`, propietario `sk3l3t0r`, paquete `kida`.
Necesitas acceso a esa red y una versión publicada; no es un servicio público de descargas.
Servidor, propietario y paquete están fijados en el [script](../../scripts/install.sh).

## 1. Descargar y revisar

Sustituye las credenciales por unas autorizadas. Omite `--user` si admite lectura anónima:

```bash
curl -fsSL \
  --user 'YOUR_USER:YOUR_TOKEN' \
  http://git.atlantis.arpa/sk3l3t0r/kida/raw/branch/master/resources/scripts/install.sh \
  -o /tmp/kida-install.sh
```

Lee `/tmp/kida-install.sh` antes de ejecutarlo.

## 2. Instalar

Sustituye `RELEASE_VERSION` por la versión publicada exacta. Omite `KIDA_TOKEN` si la descarga es anónima:

```bash
sudo env \
  KIDA_VERSION='RELEASE_VERSION' \
  KIDA_TOKEN='YOUR_TOKEN' \
  bash /tmp/kida-install.sh
```

El instalador verifica checksums, instala `kida-core` y `kida` en `/usr/local/bin` y habilita e inicia `kida.service`.
El servicio funciona como root. No se instalan Docker, el plugin Compose ni `rtcwake`.

## 3. Comprobar

```bash
systemctl --no-pager --full status kida
kida system info
```

Comprueba ambos resultados aunque el instalador anuncie éxito.
Continúa con [primeros pasos](002-usage-overview.md) o [solución de problemas](troubleshooting.md).
Antes de editar ajustes, consulta [configuración](configuration.md).
