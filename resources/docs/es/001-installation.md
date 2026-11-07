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

El asistente instala siempre CORE y pregunta por CLI y Console por separado
(ambas opcionales, respuesta por defecto: no). Instala en orden CORE → CLI →
Console; omitir un componente no elimina instalaciones anteriores.

Verifica los checksums de los binarios seleccionados e instala CORE y, si se
elige, `kida` en `/usr/local/bin`. Habilita y reinicia `kida.service`, que funciona
como root. Muestra progreso por etapa y solo anuncia éxito tras comprobar los
servicios. No instala Docker, Compose ni `rtcwake`.

Si eliges Console, comprueba primero Docker y Compose (con soporte de
`up --wait-timeout`) y descarga la imagen
`git.atlantis.arpa/sk3l3t0r/kida-console:RELEASE_VERSION`. Si falla esta
comprobación, no instala ningún componente. La versión debe tener imagen
publicada; las releases antiguas pueden carecer de ella. `KIDA_TOKEN` también
se utiliza para autenticar la descarga de la imagen, sin conservar ese login.

El registry usa HTTP: tanto el daemon del equipo como el del runner de releases
necesitan autorizar `git.atlantis.arpa` como registry inseguro. El instalador no
modifica Docker. HTTP transmite credenciales sin cifrar; úsalo únicamente en
una red de confianza.

En la primera instalación de Console, introduce el origen público HTTP o HTTPS
y una contraseña de administrador de 12–128 caracteres (oculta y confirmada).
HTTP directo puede usar `http://IP_DEL_HOST:8000`; HTTPS necesita un proxy TLS
externo, que este script no configura. Las cookies se configuran según el
protocolo elegido. La configuración se guarda en `/opt/kida-console/.env` con
permisos `0600`, junto al Compose de despliegue. Las reinstalaciones conservan
ese archivo y el volumen de cuentas y sesiones. El proyecto Compose se llama
`kida-console` y usa red host. El script espera hasta 120 segundos a que Console
esté saludable.

Si una etapa falla, el mensaje identifica los componentes ya completados;
no se revierte automáticamente su instalación. Ejecuta el script descargado
con entrada interactiva disponible; no lo envíes a Bash mediante una tubería.

## 3. Comprobar

```bash
systemctl --no-pager --full status kida
kida system info
```

Ejecuta `kida system info` solo si instalaste CLI. Si instalaste Console:

```bash
sudo docker compose --project-name kida-console -f /opt/kida-console/compose.yaml ps
```

Comprueba los componentes seleccionados aunque el instalador anuncie éxito.
Continúa con [primeros pasos](002-usage-overview.md) o [solución de problemas](troubleshooting.md).
Antes de editar ajustes, consulta [configuración](configuration.md).
