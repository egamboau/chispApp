# ChispApp

Aplicación para administrar y mostrar los torneos de la Asociación Deportiva de Jupas, con datos proporcionados por Chisperos.

Permite administrar varios torneos activos, fases, grupos, membresías, sanciones y rangos de clasificación. La vista pública calcula las tablas por grupo con partidos finalizados y aplica los desempates del Artículo 19; los destinos mostrados son informativos y no inscriben equipos automáticamente.

## Requisitos

- Node.js 20 o superior y npm, o Docker.
- Docker Swarm inicializado para el despliegue con `stack.yml`.

## Ejecución local

```bash
cd frontend
npm ci
npm run build
cd ../backend
npm ci
npm start
```

La base de datos local se crea en `./data/tournament.db`. Abre:

- Pantalla pública: <http://localhost:3000/display>
- Torneos, fases y grupos: <http://localhost:3000/admin>
- Inscripción de equipos: <http://localhost:3000/admin/teams.html>
- Calendario de la fase actual: <http://localhost:3000/admin/calendar.html>
- Informe de goleo: <http://localhost:3000/admin/scoring.html>

Para desarrollo con reinicio automático:

```bash
cd backend
npm run dev
```

El frontend React en migración se ejecuta por separado y todavía no sustituye la UI vanilla. Vite publica la vista previa en <http://localhost:5173/react/> y envía `/api` a Express en el puerto 3000:

```bash
cd frontend
npm ci
npm run dev
```

El build de producción queda disponible en `/react/`. Express devuelve la entrada React para rutas anidadas como `/react/deep/link`, mientras `/display` y `/admin` continúan sirviendo la interfaz actual.

## Docker Compose

```bash
docker compose up --build -d
docker compose logs -f tournament
```

El volumen `tournament-data` conserva la base de datos al reiniciar o reemplazar el contenedor.

## Docker Swarm

El despliegue usa Jenkins con agentes separados para construir y desplegar. Cada cambio en `main` ejecuta las pruebas durante la construcción de la imagen, la etiqueta como `sha-...`, la publica en `nas-server.local:5000` y actualiza el stack.

Antes del primer despliegue, crea la red y prepara el export NFS:

```bash
docker swarm init # solo la primera vez
docker network create --driver overlay --attachable public-ingress
```

Configura un job **Pipeline from SCM** apuntando a `main` y usando `Jenkinsfile`. Jenkins ejecuta el build y push en un único agente Docker con etiqueta `node-24`, Node.js 24 y acceso al registry local. El agente `swarm-manager` solo realiza el despliegue y necesita acceso al daemon de un manager. No habilites builds de pull requests: ambos agentes tienen acceso a Docker.

Configura en Jenkins:

- Variables `NFS_SERVER`, `NFS_EXPORT`, `CF_ACCESS_TEAM_DOMAIN` y `CF_ACCESS_AUD`.

El registry debe ser accesible como `nas-server.local:5000` desde Jenkins y todos los nodos. Usa TLS; si requiere autenticación, ejecuta `docker login nas-server.local:5000` con el usuario de Jenkins. Verifica resolución con `getent hosts nas-server.local` en cada nodo.

El export NFS debe existir y ser escribible desde todos los nodos del Swarm. El pipeline consulta Git cada dos minutos, publica la imagen y ejecuta:

```bash
TOURNAMENT_IMAGE=nas-server.local:5000/jupas-app:sha-COMMIT \
  docker stack deploy --with-registry-auth --resolve-image always -c stack.yml tournament
```

El servicio usa una sola réplica porque SQLite no admite escritores simultáneos desde varios nodos. El volumen `tournament-data` monta el mismo export NFSv4 desde cualquier nodo. Sin `TOURNAMENT_IMAGE`, `stack.yml` y `docker-compose.yml` conservan `tournament-display:latest` para builds locales.

Para revertir el último despliegue sin modificar la base de datos:

```bash
docker service rollback tournament_tournament
docker service ps tournament_tournament
curl --fail https://HOST/api/tournaments
curl --fail https://HOST/display/
```

Comprueba también `/admin/` con una sesión de Cloudflare Access. Las pruebas HTTP verifican que las rutas vanilla y React coexisten, por lo que retirar la imagen nueva restaura únicamente los assets y el servidor anteriores.

En producción no se publica el puerto 3000. El servicio `cloudflared` debe pertenecer a la red overlay `public-ingress` y dirigir el hostname público a `http://tournament:3000`.

## Variables de entorno

| Variable | Predeterminado | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP. |
| `DATABASE_PATH` | `./data/tournament.db` local, `/data/tournament.db` en Docker | Archivo SQLite persistente. |
| `NODE_ENV` | — | Usa `development` con `npm run dev`. |
| `FRONTEND_DIST_PATH` | `../frontend/dist` desde `backend/` | Build de React servido en `/react/`. |
| `CF_ACCESS_TEAM_DOMAIN` | — | Dominio completo del equipo, por ejemplo `https://equipo.cloudflareaccess.com`. Obligatorio en producción. |
| `CF_ACCESS_AUD` | — | Application Audience Tag de Cloudflare Access. Obligatorio en producción. |

Las tablas se crean automáticamente al arrancar. No se cargan datos ficticios en producción.

## Referencias de participantes (issue #40)

El modelo interno permite equipos fijos (`TEAM`), posiciones de clasificación
(`GROUP_POSITION`: fase, grupo y posición) y ganadores de encuentros eliminatorios
(`MATCH_WINNER`: ID del partido). Los tres roles —local, visitante y línea— admiten
cualquiera de estas variantes. Los contratos están en `src/models/match.ts`;
`MatchService.saveParticipantMatch(input, id?)` guarda un partido nuevo o edita uno
programado, y `getMatchParticipants(id)` devuelve la referencia original junto con
el ID del equipo resuelto, que puede ser `null`.

Las referencias de clasificación requieren una fase de tabla anterior del mismo
torneo y categoría, un grupo de esa fase y una posición entre 1 y sus inscritos
actuales. Los ganadores pueden proceder de la misma fase eliminatoria o de una
anterior; se rechazan referencias circulares. El partido origen se identifica por
su ID, por lo que cambiar su orden de calendario no altera la referencia.

La migración automática agrega `match_participant_references` y completa IDs de
equipos históricos que solo tenían nombre, sin cambiar nombres, marcadores ni
goleo. El equipo resuelto permanece en las columnas de equipo existentes; asignarlo
no elimina la referencia de origen. Las ediciones antiguas de un partido con
referencias se rechazan para evitar perderlas. Los selectores de participantes se
mantienen en el modelo interno; el formulario antiguo sigue creando equipos fijos.

## Resolución y confirmación de posiciones (issue #41)

En **Torneos → Fases → Cierre y asignación de posiciones**, selecciona la fase de
tabla de origen para previsualizar qué equipos ocuparían las referencias de fases
posteriores, incluidos los equipos de línea. Se reutiliza la tabla y sus desempates
vigentes. Se exige al menos una vuelta completa de enfrentamientos finalizados por
grupo, ningún partido pendiente en la fase y ningún empate sin resolver. No se
elige arbitrariamente entre equipos empatados ni se crean equipos nuevos.

**Confirmar y congelar** cierra la clasificación de origen y asigna todos sus
participantes en una transacción idempotente. Conserva fase, grupo y posición
originales, junto con una instantánea y fecha de confirmación. Los endpoints
administrativos son `GET /api/admin/phases/:id/positions`,
`POST /api/admin/phases/:id/positions/confirm` y
`POST /api/admin/phases/:id/positions/reopen`.

Las correcciones posteriores muestran una advertencia en la previsualización y no
modifican equipos asignados. Usa **Reabrir asignaciones**, revisa y confirma otra
vez. Reabrir conserva los equipos anteriores internamente para comparar cambios,
pero los partidos programados vuelven a mostrar sus referencias de posición como
pendientes hasta reconfirmar. Los partidos iniciados o terminados conservan sus
nombres. Reabrir bloquea el inicio de los partidos
pendientes que dependen de esa fase hasta reconfirmar. Si la corrección cambiaría
un participante de un partido iniciado o terminado, se rechaza toda la confirmación;
esos encuentros conservan sus equipos. Las referencias `MATCH_WINNER` quedan fuera
de esta resolución. Un encuentro con participantes sin resolver tampoco puede iniciar.

La migración agrega `phase_position_confirmations` sin modificar los resultados
existentes y se puede ejecutar nuevamente al reiniciar. Para volver a una versión
sin esta funcionalidad después de confirmar, restaura el respaldo previo: esa
versión no aplica los bloqueos de confirmación. No ejecutar ambas versiones a la vez.

Antes de desplegar, generar y verificar el respaldo descrito abajo. La migración es
aditiva e idempotente: si todavía no se guardaron referencias, se puede volver a la
imagen anterior conservando la base. Una vez guardadas, para revertir hay que detener
la aplicación y restaurar el respaldo previo junto con la imagen anterior; se
perderán los cambios posteriores al respaldo. No ejecutar versiones anteriores contra
una base que ya tenga referencias: pueden interpretar sus etiquetas como equipos.

## Cloudflare Access

Crea una aplicación Access para el mismo hostname con los paths `/admin`, `/admin/*`, `/api/admin` y `/api/admin/*`, y habilita **Protect with Access** en el Tunnel. El panel transforma sus llamadas a `/api/admin/*`; la aplicación valida `Cf-Access-Jwt-Assertion` contra el [JWKS de Cloudflare](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/). La API pública solo conserva las lecturas usadas por `/display`.

El despliegue falla si faltan las variables de Access. `docker compose` usa `NODE_ENV=development` y mantiene el puerto 3000 únicamente para desarrollo local.

## Backup de SQLite

El respaldo usa la API de backup de SQLite, valida el snapshot, lo comprime y lo sube a `onedrive:Documents/Jupas/ChispAppBackups/` sin detener la aplicación.

### Configurar OneDrive

Instala rclone en una computadora con navegador y crea un archivo protegido fuera del repositorio:

```bash
install -d -m 700 "$HOME/.config/chispapp"
rclone config --config "$HOME/.config/chispapp/rclone.conf"
```

Crea el remote con el nombre exacto `onedrive`, selecciona Microsoft OneDrive y completa el inicio de sesión. Si configuras desde una máquina sin navegador, responde que no deseas abrirlo automáticamente, ejecuta `rclone authorize onedrive` en una computadora con navegador y pega el resultado cuando se solicite.

Prueba el acceso y crea la carpeta inicial:

```bash
rclone --config "$HOME/.config/chispapp/rclone.conf" lsd onedrive:
rclone --config "$HOME/.config/chispapp/rclone.conf" mkdir onedrive:Documents/Jupas/ChispAppBackups
```

No copies `rclone.conf` al repositorio: contiene los tokens de OneDrive. Para probar el contenedor localmente:

```bash
docker compose build backup
RCLONE_CONFIG_PATH="$HOME/.config/chispapp/rclone.conf" \
  docker compose --profile tools up --no-deps --abort-on-container-exit --exit-code-from backup backup
```

El archivo se guarda como `/backups/tournament-FECHA.db.gz` dentro del contenedor detenido. No uses `--rm`: al eliminar o recrear el contenedor también se eliminan sus respaldos. Para copiar los archivos antes de una restauración:

```bash
mkdir -p backups
docker compose cp backup:/backups/. ./backups/
gzip -t backups/tournament-*.db.gz
```

Para restaurar, detén la aplicación, descomprime el archivo elegido como `tournament.db` y reemplaza la base del volumen.

En un manager de Swarm, crea el secreto una sola vez usando la ruta real del archivo:

```bash
docker secret create chispapp-rclone-config /ruta/protegida/rclone.conf
docker secret inspect chispapp-rclone-config
```

En producción, el pipeline principal publica `jupas-app-backup:sha-COMMIT` y ejecuta un job de Swarm antes del despliegue. El job monta el mismo export NFS en modo solo lectura e inyecta el secreto como `/run/secrets/rclone.conf`. Si el snapshot, la autenticación o la transferencia fallan, Jenkins no despliega la nueva versión.

Para el respaldo semanal, crea otro job **Pipeline from SCM** apuntando a `main`, configura `Jenkinsfile.backup` como **Script Path** y conserva las variables `NFS_SERVER` y `NFS_EXPORT` en las propiedades de la carpeta. Ese pipeline ejecuta `jupas-app-backup:latest` cada martes a las 00:00, hora de Guatemala.

Los secretos de Swarm no se pueden modificar. Para renovar una autorización vencida, genera y prueba otro `rclone.conf`, localiza y elimina primero el job de backup completado que usa el secreto, y vuelve a crearlo:

```bash
docker service ls --filter label=com.chispapp.backup=true
docker service rm NOMBRE_DEL_JOB_COMPLETADO
docker secret rm chispapp-rclone-config
docker secret create chispapp-rclone-config /ruta/protegida/rclone.conf
```

El contenedor copia el secreto a un archivo temporal escribible para que rclone pueda renovar el token durante cada ejecución; esa copia se elimina al terminar.

## Pruebas

```bash
cd backend
npm test
```
