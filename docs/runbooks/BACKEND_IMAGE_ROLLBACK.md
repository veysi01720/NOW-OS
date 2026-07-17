# BACKEND IMAGE ROLLBACK RUNBOOK

## Overview
This runbook describes how to safely rollback the \
ow_os_backend\ service to a previously verified immutable image without disrupting the gateway (Evolution) or databases.

## Steps

### 1. Identify Target Image
Identify the previous immutable image tag (e.g., \
ow_os_backend:rollback-pre-b5p-<timestamp>\).

### 2. Update Compose
Temporarily update the \docker-compose.yml\ to point the \
ow_os_backend\ service to the rollback tag.

### 3. Recreate Container (Backend Only)
Run the following command to safely recreate only the backend container:
\\\ash
docker compose up -d --no-deps --force-recreate now_os_backend
\\\

**CRITICAL:** 
- Do NOT run \docker-compose down\
- Do NOT recreate Evolution or other dependencies
- Do NOT delete volumes or reset databases

### 4. Verify Health
Ensure the backend is healthy:
- Check container status: \docker ps\
- Check API health: \curl -s http://127.0.0.1:3000/healthz | grep ok\
- Verify Connection Doctor: \curl -s http://127.0.0.1:3000/healthz/connection-doctor\

### 5. Verify Behavior State
Ensure the rollback properly enforces Behavior off state:
- \ehavior_live_canary_gate_default_deny=true\ (if B4 is present in the rollback)
- \ehavior_orchestrator_enabled=false\
- \ehavior_canary_mode=off\
- Webhook target and session are unchanged.
