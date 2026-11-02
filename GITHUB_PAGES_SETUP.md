# GitHub Actions: Automated Google Cloud & GitHub Pages Deployment

Whenever you push to the `githubpages` branch, the GitHub Action at [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) runs a two-step automated deployment:

1. **Job 1 (Deploy Backend)**: Builds and deploys [`server.js`](server.js) container to **Google Cloud Run**, passing your Google Apps Script credentials securely.
2. **Job 2 (Deploy Frontend)**: Captures the newly deployed Cloud Run URL, automatically injects it into `index.html`, fingerprints assets with `npm run build`, and deploys the frontend to **GitHub Pages**.

---

## Required Setup in Your GitHub Repository

In your GitHub repository, go to **Settings → Secrets and variables → Actions** and configure the following:

### 1. Repository Secrets (`Secrets` tab)

Click **New repository secret** and add:

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `GCP_SA_KEY` | `{ "type": "service_account", ... }` | Full JSON key file of a Google Cloud Service Account with Cloud Run deployment permissions. |
| `GOOGLE_APPS_SCRIPT_URL` | `https://script.google.com/macros/s/.../exec` | Your Google Apps Script deployment URL. |
| `REGISTRATION_SECRET` | `your-secret-key` | Your private registration secret from Apps Script. |

---

## How to Create the Service Account Key (`GCP_SA_KEY`)

You can create this key in one command using your local `gcloud` CLI (replace `YOUR_PROJECT_ID` with your desired project, e.g. `imposter-510904`):

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Enable required Google APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com iam.googleapis.com

# Create Service Account
gcloud iam service-accounts create github-deployer \
    --display-name="GitHub Actions Cloud Run Deployer"

# Grant roles to the service account
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Generate the JSON key file
gcloud iam service-accounts keys create gcp-key.json \
    --iam-account=github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Open `gcp-key.json`, copy the entire text, and paste it into GitHub as the secret **`GCP_SA_KEY`**. *(Delete `gcp-key.json` from your local machine afterwards for safety).*

---

## 2. Enable GitHub Pages

In your repository on GitHub:
1. Go to **Settings → Pages**.
2. Under **Build and deployment > Source**, select **GitHub Actions**.

---

## 3. Trigger Deployment

Now, every time you commit and push to the `githubpages` branch:
```bash
git push origin githubpages
```
GitHub Actions will automatically deploy both your Google Cloud backend and your GitHub Pages frontend!
