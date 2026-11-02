# GitHub Pages + Google Cloud Setup

This branch (`githubpages`) is set up to host the frontend on **GitHub Pages** while communicating with the registration backend on **Google Cloud Run** (or any custom server).

---

## Architecture

```
User Browser (GitHub Pages) ──── CORS POST ────▶ Google Cloud Run (/api/register) ────▶ Google Apps Script ────▶ Google Sheet
(https://<username>.github.io/<repo>)            (https://<service-url>.a.run.app)       (keeps secret private)
```

1. **GitHub Pages**: Serves static HTML, CSS, JS, and poster assets.
2. **Google Cloud Run**: Runs the lightweight server ([`server.js`](server.js) containerized via [`Dockerfile`](Dockerfile)) with CORS enabled for your GitHub Pages domain. It securely holds `REGISTRATION_SECRET` and `GOOGLE_APPS_SCRIPT_URL` without exposing them in the client.
3. **Google Sheets / Apps Script**: Stores registrations and enforces duplicate phone checks.

---

## 1. Deploy the Backend to Google Cloud Run

Run this command from your terminal:

```bash
gcloud run deploy ies-registration \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",REGISTRATION_SECRET="your-copied-secret"
```

Once deployment completes, note down the Cloud Run Service URL:
```
https://ies-registration-xxxx.a.run.app
```

---

## 2. Point Frontend to Your Cloud Run Backend

In [`index.html`](index.html), find the `<script>` block in `<head>` and paste your Cloud Run URL:

```html
<script>
    window.IES_CONFIG = {
        backendUrl: 'https://ies-registration-xxxx.a.run.app',
        whatsappCommunityUrl: '' // optional WhatsApp community invite
    };
</script>
```

Rebuild:
```bash
npm run build
```

---

## 3. Deploy Frontend to GitHub Pages

### Automatic Deployment (GitHub Actions)
A workflow has been added at [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

1. Push this branch to GitHub:
   ```bash
   git push -u origin githubpages
   ```
2. Go to your GitHub repository:
   - Click **Settings → Pages**.
   - Under **Build and deployment > Source**, select **GitHub Actions**.
3. Every push to the `githubpages` branch will automatically compile the site and deploy the `dist/` directory to GitHub Pages!
