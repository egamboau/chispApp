# Pantalla de torneo

Aplicación sencilla con Node.js, Express, SQLite, HTML/CSS/JavaScript y actualizaciones en vivo mediante Server-Sent Events.

## Requisitos

- Node.js 20 o superior y npm, o Docker.
- Docker Swarm inicializado para el despliegue con `stack.yml`.

## Ejecución local

```bash
npm ci
npm start
```

La base de datos local se crea en `./data/tournament.db`. Abre:

- Pantalla pública: <http://localhost:3000/display>
- Administración: <http://localhost:3000/admin>

Para desarrollo con reinicio automático:

```bash
npm run dev
```

## Docker Compose

```bash
docker compose up --build -d
docker compose logs -f tournament
```

El volumen `tournament-data` conserva la base de datos al reiniciar o reemplazar el contenedor.

## Docker Swarm

El despliegue usa Jenkins en un nodo manager. Cada cambio en `main` ejecuta las pruebas, construye una imagen con etiqueta `sha-...`, la publica en GHCR y actualiza el stack.

Antes del primer despliegue, crea la red y prepara el export NFS:

```bash
docker swarm init # solo la primera vez
docker network create --driver overlay --attachable public-ingress
```

Configura un job **Pipeline from SCM** apuntando a `main` y usando `Jenkinsfile`. El agente con etiqueta `swarm-manager` necesita Node.js 20+, Docker y acceso al daemon de un manager. No habilites builds de pull requests: ese agente controla Docker del servidor.

Configura en Jenkins:

- Credencial `ghcr`, tipo **Username with password**, usando un PAT classic con permiso `write:packages`.
- Variable `GHCR_IMAGE`, por ejemplo `ghcr.io/PROPIETARIO/REPOSITORIO`.
- Variables `NFS_SERVER` y `NFS_EXPORT`.

El export NFS debe existir y ser escribible desde todos los nodos del Swarm. El pipeline consulta Git cada dos minutos, publica la imagen privada y ejecuta:

```bash
TOURNAMENT_IMAGE=ghcr.io/PROPIETARIO/REPOSITORIO:sha-COMMIT \
  docker stack deploy --with-registry-auth --resolve-image always -c stack.yml tournament
```

El servicio usa una sola réplica porque SQLite no admite escritores simultáneos desde varios nodos. El volumen `tournament-data` monta el mismo export NFSv4 desde cualquier nodo. Sin `TOURNAMENT_IMAGE`, `stack.yml` y `docker-compose.yml` conservan `tournament-display:latest` para builds locales.

## Variables de entorno

| Variable | Predeterminado | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP. |
| `DATABASE_PATH` | `./data/tournament.db` local, `/data/tournament.db` en Docker | Archivo SQLite persistente. |
| `NODE_ENV` | — | Usa `development` con `npm run dev`. |

Las tablas se crean automáticamente al arrancar. No se cargan datos ficticios en producción.

## Backup de SQLite

Detén brevemente las escrituras y copia el archivo desde el volumen mediante un contenedor temporal:

```bash
docker run --rm -v jupas-app_tournament-data:/data -v "$PWD":/backup alpine cp /data/tournament.db /backup/tournament-backup.db
```

En Swarm, consulta el nombre real del volumen con `docker volume ls` y sustitúyelo en el comando. Para restaurar, detén el servicio y copia el backup de vuelta como `/data/tournament.db`.

## Pruebas

```bash
npm test
```
