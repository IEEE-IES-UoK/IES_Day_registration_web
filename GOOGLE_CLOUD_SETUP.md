# Deploying IEEE IES Day Registration to Google Cloud

This project is prepared for deployment on **Google Cloud Run** (recommended container-based serverless) or **Google App Engine**.

---

## Prerequisites

1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`).
2. Log in and select or create a GCP project:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. Enable Cloud Run and Artifact Registry APIs:
   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com
   ```

---

## Option 1: Deploy to Google Cloud Run (Recommended)

Google Cloud Run automatically scales to zero when idle, minimizing cost.

### 1. Build and Deploy from Source Directly
Run one command from the project root:

```bash
gcloud run deploy ies-registration \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",REGISTRATION_SECRET="your-copied-secret"
```

### 2. Verify Deployment
Once the deployment finishes, `gcloud` outputs your Service URL (e.g., `https://ies-registration-xxxx.a.run.app`).

Open the URL in your browser and submit a test registration.

---

## Option 2: Deploy to Google App Engine

If you prefer App Engine standard environment:

```bash
# 1. Build the production assets
npm run build

# 2. Deploy to App Engine
gcloud app deploy app.yaml
```

Set environment variables in Google Cloud Console under **App Engine → Configuration** or append `GOOGLE_APPS_SCRIPT_URL` and `REGISTRATION_SECRET` under `env_variables:` in `app.yaml`.

---

## Local Container Testing (Optional)

To test the container before deploying to Google Cloud:

```bash
# Build Docker image
docker build -t ies-registration .

# Run locally
docker run -p 8080:8080 --env-file .env ies-registration
```
Then visit `http://localhost:8080`.

