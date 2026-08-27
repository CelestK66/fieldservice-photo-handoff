#!/usr/bin/env bash
set -euo pipefail

curl --request POST http://localhost:3000/upload-intents \
  --header 'Content-Type: application/json' \
  --data '{"workOrderId":"WO-1842","technicianId":"TECH-7","fileName":"meter.webp","contentType":"image/webp","bytes":245760}'
