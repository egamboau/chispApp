FROM alpine:3.22

RUN apk add --no-cache rclone sqlite \
    && adduser -D -u 1000 backup \
    && mkdir -p /backups \
    && chown backup:backup /backups

COPY backup.sh /usr/local/bin/backup-sqlite
RUN chmod 755 /usr/local/bin/backup-sqlite

USER backup
ENTRYPOINT ["backup-sqlite"]
