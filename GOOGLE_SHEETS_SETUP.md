# Google Sheets + Netlify setup

Create a **Google Sheet only**. The custom website is already the registration form, so a Google Form is unnecessary. IEEE IES Day takes place on November 12, 2026, at the A11 Building Auditorium, University of Kelaniya. The form collects full name, email address, university name, faculty / department, and WhatsApp number.

The data path is:

```text
Website → POST /api/register on Netlify → Apps Script web app → Registrations tab
```

The browser never receives the storage secret or the Apps Script deployment URL. A registration is confirmed only after Google Sheets accepts the write.

## 1. Create the spreadsheet and install the script

1. Create a blank Google Sheet named **IEEE IES Day 2026 — Registrations**.
2. In the Sheet, choose **Extensions → Apps Script**.
3. Replace the default `Code.gs` with the full contents of [google-apps-script/Code.gs](google-apps-script/Code.gs), then save.
4. In Apps Script **Project Settings**, enable **Show “appsscript.json” manifest file in editor**. Replace that manifest with [google-apps-script/appsscript.json](google-apps-script/appsscript.json) and save.
5. Select **setupRegistrationSheet** in the function dropdown and click **Run**. Approve the spreadsheet permissions requested by your script.

The setup function prepares the `Registrations` tab, freezes and styles its header, applies text formatting to registration fields, and uses the **Asia/Colombo** timezone. It also stores `SPREADSHEET_ID` and generates `REGISTRATION_SECRET` in **Project Settings → Script properties**. Rerunning setup preserves the existing secret and registrations.

If reusing a spreadsheet that already has registrations, rename its existing `Registrations` tab to an archive name before running setup. This preserves those records and lets setup create a fresh `Registrations` tab with the current IEEE IES Day schema. Do not delete the archive. The setup script will not migrate or overwrite existing rows.

The columns are:

| Column | Contents                          |
| ------ | --------------------------------- |
| A      | Submitted At                      |
| B      | Full name                         |
| C      | Email                             |
| D      | University                        |
| E      | Faculty / Department              |
| F      | WhatsApp                          |
| G      | Request ID, used for safe retries |

Keep the column order and header names intact. Use a separate tab for organizer summaries.

## 2. Deploy the Apps Script web app

1. Click **Deploy → New deployment**.
2. Choose **Web app** as the deployment type.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**. The Netlify server authenticates with the private registration secret; the spreadsheet itself does not need to be public.
5. Deploy and copy the web app URL ending in **`/exec`**. Use this URL, not the editor’s `/dev` test URL.

In **Project Settings → Script properties**, copy the generated `REGISTRATION_SECRET` for the next step. Do not put it in `site.js` or the Sheet’s cells.

## 3. Configure and deploy Netlify

Import this project into Netlify from your repository, using the folder containing `Netlify.json` as the project root. The included configuration sets:

- Framework preset: **Other**
- Build command: **npm run build**
- Output directory: **dist**
- Node.js: **24.x**
- Registration function: **netlify/functions/register.js**, with a 30-second maximum duration
- Function region: **Mumbai (`bom1`)**, chosen as a starting point for this Sri Lankan event

Add these two variables in **Netlify → Project Settings → Environment Variables**:

| Variable                 | Value                                               |
| ------------------------ | --------------------------------------------------- |
| `GOOGLE_APPS_SCRIPT_URL` | The Apps Script web app `/exec` URL                 |
| `REGISTRATION_SECRET`    | The exact secret from Apps Script Script properties |

Enable them for **Production**. Configure Preview separately if preview deployments should also store registrations; use a separate test Sheet/script deployment for those if you want to keep test rows out of the production Sheet.

Deploy or redeploy after setting the variables. The site automatically uses the real `/api/register` endpoint on hosted domains. File previews and localhost stay in preview mode and do not save data.

## 4. Verify the live connection

1. Open the **Netlify deployment URL**, fill the form with test details, and submit.
2. Confirm one row appears in the `Registrations` tab and the website shows **Registration complete!**.
3. Confirm the saved row contains all five submitted details and a Request ID.
4. A request retried with the same Request ID should return success without adding a second row. This protects slow-connection retries.
5. Remove the test row from the Sheet once verification is complete.

Local automated checks mock Google storage; they do not replace this deployment test. The project is not connected to your Google account until you complete the deployment and environment settings above.

## Speed and reliability

- The page has no framework bundle or runtime dependencies. The build fingerprints its five browser assets so they can use long-lived cache headers without serving old versions after a change.
- The submit button responds immediately with a saving state and prevents repeated clicks while the request runs.
- The Netlify function validates the request and normally makes one upstream submission. Temporary network failures, Google HTTP 429/5xx responses, and script busy/storage-unavailable results receive up to two retries, all within one 16-second deadline. Every attempt reuses the exact request body and Request ID. There is no Google SDK to load.
- The Apps Script setup handles formatting once. Registration processing uses exact duplicate lookups and one batched row write; a script lock protects concurrent submissions.

## Optional WhatsApp community link

The confirmation popup shows a WhatsApp join button only after a successful hosted registration and only when a valid invite is configured. In `site.js`, set `CONFIG.whatsappCommunityUrl` to an HTTPS group invite such as `https://chat.whatsapp.com/...` or a channel link such as `https://whatsapp.com/channel/...`. Leave it blank to keep the button hidden. Do not put private credentials or unrelated URLs in this setting.
- Request IDs make retries safe, and only a successful write produces the success popup.

Actual save time depends on Google Apps Script startup, Google Sheets response time, and network conditions. No real latency measurements are available until the deployed connection is tested.

## Investigating an intermittent production failure

An error followed by a successful registration is not enough to identify its original cause. The older API used the same “storage temporarily unavailable” message for several Google HTTP errors and Apps Script result codes. The WhatsApp invitation change does not modify the save endpoint or Google script.

The updated Netlify endpoint records structured events in **Netlify → Project → Logs**:

- `registration_retry`: a retryable failure, with attempt number, Google HTTP status or safe result code, elapsed time, and Request ID.
- `registration_recovered`: a later attempt confirmed the registration.
- `registration_failed`: retries ended or the response was a permanent failure.

These logs omit names, phone numbers, student IDs, deployment URLs, secrets, raw responses, and Google exception text. Authentication, configuration, schema, validation, and duplicate errors are not retried. An existing save found under the same Request ID counts as confirmed success.

The API returns `X-Registration-Version: 2026-10-27-ieee-ies-day-email-1`, including on a harmless GET `/api/register` response, so the deployed backend revision can be checked without making a registration.

For Google-side detail:

1. Copy the latest `google-apps-script/Code.gs` into the existing bound Apps Script project and save. Keep its Script properties intact.
2. Choose **Deploy → Manage deployments → Edit → New version → Deploy**. Updating GitHub alone does not update Apps Script. Keeping the same deployment preserves the existing `/exec` URL.
3. Run **diagnoseRegistrationStorage** from the Apps Script editor. It only reads configuration and the spreadsheet. Its report includes access/schema checks, a registration count, and a deployment version; it never creates rows or changes settings.
4. Open **Executions**, select the relevant `doPost` invocation, and expand its logs. A handled storage failure can still have execution status **Completed**, so inspect its logs rather than filtering only for failed executions.
5. Look for `registration_storage_failure`, which records a processing phase and a fixed category such as rate-limit, quota, permission, document-unavailable, or service-error. No raw error message or registration data is logged.

The Apps Script source in this repository is version `2026-10-27-ieee-ies-day-email-1`. A deployed script returns its own version from the public `/exec` GET health response. Do not regenerate the registration secret as a troubleshooting step; Netlify and Apps Script must retain the same value.

The local bridge test simulates a row being committed and its response being lost. The automatic retry must return success with exactly one stored row. Live production recovery still requires real deployment logs to verify; automated tests do not establish the cause of a historical incident.

## Updating or troubleshooting

- **Script code changes:** use **Deploy → Manage deployments → Edit → New version → Deploy**. Saving the editor alone does not update an existing web app deployment.
- **“Not configured” / storage unavailable:** check both Netlify environment variables, redeploy Netlify, and verify the Apps Script deployment access setting and matching secret.
- **Header/schema error:** restore the original header order or use a fresh `Registrations` tab; the script avoids overwriting an unrelated table.
- **Busy or timed out:** retry. The same request ID prevents an already-saved registration from being inserted twice.
- **Preview message:** localhost intentionally does not save. Run the real connection test on the Netlify deployment.

References: [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web), [Apps Script performance guidance](https://developers.google.com/apps-script/guides/support/best-practices), [Netlify Node.js functions](https://Netlify.com/docs/functions/runtimes/node-js), [Netlify project configuration](https://Netlify.com/docs/project-configuration/Netlify-json).
