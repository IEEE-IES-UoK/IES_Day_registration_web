#!/usr/bin/env bash
set -e

echo "==================================================="
echo " IEEE IES Day 2026 - Google Cloud Run Deploy Script"
echo "==================================================="

if [ ! -f .env ]; then
  echo "[ERROR] .env file not found."
  exit 1
fi

export $(grep -v '^#' .env | xargs)

if [ -z "$GOOGLE_APPS_SCRIPT_URL" ] || [ -z "$REGISTRATION_SECRET" ]; then
  echo "[ERROR] Missing GOOGLE_APPS_SCRIPT_URL or REGISTRATION_SECRET in .env"
  exit 1
fi

SERVICE_NAME="ies-registration-backend"
REGION="asia-south1"

echo "Deploying to Cloud Run ($SERVICE_NAME) in region $REGION..."

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_APPS_SCRIPT_URL="$GOOGLE_APPS_SCRIPT_URL",REGISTRATION_SECRET="$REGISTRATION_SECRET"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format="value(status.url)")

echo "==================================================="
echo " Deployment Succeeded!"
echo " Backend Service URL: $SERVICE_URL"
echo " Next step: update 'backendUrl' in index.html with: $SERVICE_URL"
echo "==================================================="
