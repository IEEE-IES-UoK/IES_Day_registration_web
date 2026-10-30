# IEEE IES Day — Registration

Responsive single-page registration website for IEEE IES Day on **November 12, 2026, 9:00 AM–12 noon**, at the **A11 Building Auditorium, University of Kelaniya**. Event attendees will receive an e-certificate, and the quiz invites participants to compete for prizes. The design echoes the supplied poster's charcoal-black, fiery orange, and warm cream palette; the editable hero keeps the event details accurate while the poster says “Coming Soon.”

## Registration questions

The form asks for:

- Full name
- Email address
- University name
- Faculty / department
- WhatsApp number

All five fields are required. Carols, singing, instruments, volunteer support, and rehearsal questions have been removed.

After a successful hosted registration, the confirmation popup can show a WhatsApp group or channel invitation. To enable it, set `whatsappCommunityUrl` in `site.js` to a secure WhatsApp group (`https://chat.whatsapp.com/...`) or channel (`https://whatsapp.com/channel/...`) link. It is intentionally blank by default, so the button stays hidden until organizers configure a valid invite.

## Files

- `index.html` — event page, form fields, confirmation, and commented contact-detail placeholder
- `styles.css` and `form-theme.css` — responsive layout and IEEE IES Day visual theme
- `site.js` — validation, preview mode, submission, and confirmation
- `api/register.js` — Netlify registration endpoint; secrets remain on the server
- `google-apps-script/Code.gs` — Google Sheets setup, storage, locking, and safe retries
- `google-apps-script/appsscript.json` — Apps Script runtime, timezone, and permissions
- `Netlify.json` and `scripts/build.cjs` — deployment configuration and fingerprinted production build
- `GOOGLE_SHEETS_SETUP.md` — Google Sheet and Netlify deployment instructions
- `tests/` and `test_site.py` — endpoint, Apps Script, build, and browser checks

## Replace the event graphic with your poster

When the official poster is ready:

1. Save a web-optimized poster image (WebP or JPEG recommended) in the `assets` folder, for example `assets/ies-day-poster.webp`.
2. In `index.html`, find `<div class="event-card">` inside `.hero-visual` and replace that block with:

   ```html
   <div class="poster-frame">
     <img
       src="assets/ies-day-poster.webp"
       alt="Official IEEE IES Day 2026 event poster"
       width="1200"
       height="1600"
       decoding="async"
       fetchpriority="high"
     />
   </div>
   ```

3. If the poster is not portrait, adjust the `.poster-frame img` aspect ratio in `styles.css` so it matches the image.
4. Update the social preview image by adding `<meta property="og:image" content="assets/ies-day-poster.webp"/>` to the page `<head>`.
5. Run `npm run build` and check the page on mobile and desktop.

The production build includes only assets listed in `scripts/build.cjs`; add the new poster path to its `assets` list so the poster is fingerprinted and deployed.

## Configure Google Sheets and Netlify

The custom form posts to `/api/register`; no Google Form is needed. Follow [GOOGLE_SHEETS_SETUP.md](GOOGLE_SHEETS_SETUP.md) to create the spreadsheet, run `setupRegistrationSheet()`, deploy the Apps Script web app, and configure these private Netlify environment variables:

- `GOOGLE_APPS_SCRIPT_URL`
- `REGISTRATION_SECRET`

Localhost/file previews do not save data. A hosted registration is confirmed only after storage succeeds. Existing registration rows should be preserved in a separate archive tab; use a fresh `Registrations` tab for the updated question schema, which now includes email.

## Local preview and checks

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

```bash
python3 test_site.py
npm test
npm run build
```

The browser harness uses local or bundled Node Playwright and mocks all registration requests. Automated tests do not verify a live Google Sheet; after deployment, submit one real test registration and confirm it appears in the sheet.

Collect only the details needed for the event, restrict access to organizers, and delete records when they are no longer needed.
