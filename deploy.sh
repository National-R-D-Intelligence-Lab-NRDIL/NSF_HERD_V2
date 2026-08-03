#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
git pull
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
