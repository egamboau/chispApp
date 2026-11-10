#!/bin/sh
set -eu

database=/data/tournament.db
backup_dir=/backups
rclone_secret=/run/secrets/rclone.conf
rclone_config=/tmp/rclone.conf
remote_dir=onedrive:Documents/Jupas/ChispAppBackups
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot="$backup_dir/.tournament-$timestamp.$$.db"
archive="$backup_dir/tournament-$timestamp.db.gz"
compressed="$archive.tmp"

cleanup() {
    rm -f "$snapshot" "$compressed" "$rclone_config"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ ! -r "$database" ]; then
    echo "Database is missing or unreadable: $database" >&2
    exit 1
fi
if [ ! -f "$rclone_secret" ]; then
    echo "rclone config is missing: $rclone_secret" >&2
    exit 1
fi
if [ -e "$archive" ]; then
    echo "Backup already exists: $archive" >&2
    exit 1
fi

cp "$rclone_secret" "$rclone_config"
chmod 600 "$rclone_config"
if ! rclone --config="$rclone_config" listremotes | grep -qx 'onedrive:'; then
    echo "rclone config must contain a remote named onedrive" >&2
    exit 1
fi

sqlite3 -readonly "$database" ".backup '$snapshot'"
integrity=$(sqlite3 -readonly "$snapshot" 'PRAGMA integrity_check;')
if [ "$integrity" != "ok" ]; then
    echo "Backup integrity check failed: $integrity" >&2
    exit 1
fi

gzip -c "$snapshot" > "$compressed"
mv "$compressed" "$archive"
rclone --config="$rclone_config" copyto "$archive" "$remote_dir/$(basename "$archive")"

# UTC filenames sort chronologically; prune only after the upload succeeds.
backups=$(rclone --config="$rclone_config" lsf "$remote_dir" --files-only --max-depth 1)
printf '%s\n' "$backups" |
    LC_ALL=C grep -E '^tournament-[0-9]{8}T[0-9]{6}Z\.db\.gz$' |
    LC_ALL=C sort -r |
    tail -n +4 |
    while IFS= read -r old_backup; do
        rclone --config="$rclone_config" deletefile "$remote_dir/$old_backup"
    done
rm -f "$snapshot"
rm -f "$rclone_config"
trap - EXIT HUP INT TERM

echo "Backup created and uploaded: $archive"
