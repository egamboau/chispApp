#!/bin/sh
set -eu

: "${BACKUP_IMAGE:?Set BACKUP_IMAGE}"
: "${NFS_SERVER:?Set NFS_SERVER}"
: "${NFS_EXPORT:?Set NFS_EXPORT}"

if ! docker secret inspect chispapp-rclone-config >/dev/null 2>&1; then
    echo "Docker secret is missing: chispapp-rclone-config" >&2
    exit 1
fi

timestamp=$(date -u +%Y%m%d%H%M%S)
service_name="tournament-backup-$timestamp-${BUILD_NUMBER:-manual}-$$"
mount="type=volume,source=tournament-backup-data,target=/data,readonly,volume-driver=local,volume-opt=type=nfs,volume-opt=device=:$NFS_EXPORT,\"volume-opt=o=addr=$NFS_SERVER,rw,nfsvers=4\""
timeout_seconds=300
started_at=$(date +%s)
service_created=false
keep_service=false

cleanup() {
    if [ "$service_created" = true ] && [ "$keep_service" = false ]; then
        docker service rm "$service_name" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

docker service create --detach \
    --name "$service_name" \
    --label com.chispapp.backup=true \
    --label "com.chispapp.backup.created=$timestamp" \
    --mode replicated-job \
    --replicas 1 \
    --restart-condition none \
    --with-registry-auth \
    --mount "$mount" \
    --secret source=chispapp-rclone-config,target=rclone.conf,uid=1000,gid=1000,mode=0400 \
    "$BACKUP_IMAGE" >/dev/null
service_created=true

echo "Waiting for Swarm job $service_name"
while :; do
    task_id=$(docker service ps --no-trunc -q "$service_name" | head -n 1)
    if [ -n "$task_id" ]; then
        state=$(docker inspect --format '{{.Status.State}}' "$task_id")
        case "$state" in
            complete)
                docker service logs "$service_name" || true
                for old_service in $(docker service ls --filter label=com.chispapp.backup=true --format '{{.Name}}'); do
                    [ "$old_service" = "$service_name" ] && continue
                    old_task=$(docker service ps --no-trunc -q "$old_service" | head -n 1)
                    [ -n "$old_task" ] || continue
                    old_state=$(docker inspect --format '{{.Status.State}}' "$old_task")
                    if [ "$old_state" = "complete" ]; then
                        docker service rm "$old_service" >/dev/null
                    fi
                done
                echo "Swarm backup completed: $service_name"
                keep_service=true
                exit 0
                ;;
            failed|rejected|orphaned|shutdown)
                docker service logs "$service_name" || true
                docker inspect --format 'Backup task {{.Status.State}}: {{.Status.Err}} (exit {{.Status.ContainerStatus.ExitCode}})' "$task_id" >&2 || true
                exit 1
                ;;
        esac
    fi

    now=$(date +%s)
    if [ $((now - started_at)) -ge "$timeout_seconds" ]; then
        docker service logs "$service_name" || true
        echo "Backup job timed out after ${timeout_seconds}s" >&2
        exit 1
    fi
    sleep 2
done
