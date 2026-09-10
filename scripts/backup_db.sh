#!/usr/bin/env bash
# Daily database backup: dumps herd_db and uploads it to Cloud Storage.
# Runs on the GCP VM via cron. Old backups auto-delete after 30 days
# (bucket lifecycle rule), so this script doesn't need its own cleanup logic.
set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/herd_db_backup_${TIMESTAMP}.sql"
BUCKET="gs://herdintel-db-backups"

docker exec herd_postgres pg_dump -U herd herd_db > "$BACKUP_FILE"
gcloud storage cp "$BACKUP_FILE" "${BUCKET}/${TIMESTAMP}.sql"
rm "$BACKUP_FILE"
