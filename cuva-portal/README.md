# CUVA Student Activity Portal — Netlify edition

Activity registration and QR door check-in for the College of United Volunteer Association, NUIST.
Runs entirely on **Netlify**: static pages + one Netlify Function (`/api/*`) + **Netlify Blobs** as the database.
No server to manage, no external database, no CDNs.

## Deploy (about 10 minutes)
1. Put this folder in a **GitHub** repository (the `node_modules` folder is not needed).
2. In Netlify: **Add new project → Import an existing project → GitHub →** pick the repo.
   Netlify reads `netlify.toml` automatically. Leave the build settings as they are and click **Deploy**.
3. In the project's **Environment variables**, add:
   | Key | Value |
   |---|---|
   | `SUPER_ADMIN_PASSWORD` | a strong password (8+ characters) for the Super Admin |
   Then **redeploy** once (Deploys → Trigger deploy) so the function sees it.
4. Open your site, go to **Sign In** and log in with ID `202453080043` and that password.
   The Super Admin account is created on this first sign-in.
5. In the Organizer Desk, create activities and grant organizer access to other student IDs.

> Use GitHub (or the Netlify CLI: `netlify deploy --prod`). A drag-and-drop upload only publishes the static pages, so the API would not run.

Optional environment variables:
| Key | Default | Purpose |
|---|---|---|
| `SUPER_ADMIN_ID` | `202453080043` | Root Super Admin student ID |
| `SESSION_SECRET` | auto-generated and stored in Blobs | Signing key for login cookies |

## Door check-in with the phone camera
Organizers open **Organizer → Door Check-in**:
1. **Checking in for** — pick the activity at this door (the one happening now is preselected).
   Passes for a different activity are refused and not checked in. Choose *Any activity* to accept all.
2. Tap **Scan QR Pass**. The phone's back camera opens full-screen; allow camera access when asked.
3. Point at a student's QR pass:
   - **Green — VALID • Checked in** (beep, scanner moves to the next student automatically)
   - **Amber — Already used** (shows when it was checked in)
   - **Red — Wrong activity / INVALID pass** (not admitted)
4. Close the scanner with ✕. The roster updates automatically.

Notes:
- Works in Safari (iPhone) and Chrome (Android). The ⚡ button turns on the flashlight where the phone supports it.
- Inside **WeChat**, the camera may be blocked: tap ••• → *Open in Browser*.
- "Camera not working? Type the token instead" lets you enter the code printed under the QR. A USB/Bluetooth QR scanner that types into that box also works.

## Try it on your computer first (optional)
Needs Node.js 20+.
```bash
npm install
# macOS / Linux
SUPER_ADMIN_PASSWORD=YourPassword123 npm run local
# Windows PowerShell
$env:SUPER_ADMIN_PASSWORD="YourPassword123"; npm run local
```
Open http://localhost:8888. Local data is saved in `.netlify/local-blobs` (separate from the live site).
The camera scanner also works here, because browsers allow the camera on `localhost`.

## Project structure
```
netlify.toml                 Netlify settings: publish folder, function, security headers
netlify/
  functions/api.mjs          The API (every /api/* request); permission checks
  lib/database.mjs           DATABASE: all reads/writes (Netlify Blobs)
  lib/security.mjs           Password hashing (scrypt), signed login cookies
  lib/validate.mjs           Input validation
public/                      The website
  index.html                 Discover activities
  passes.html                My QR entry passes
  organizer.html             Organizer desk
  signin.html / signup.html
  js/api.js                  Browser → API calls
  js/common.js               Shared UI, HTML escaping, campus-time helpers
  js/scanner.js              Camera QR scanner for the door
  js/pages/*.js              One script per page
  css/tailwind.css           Pre-built styles (no CDN)
  vendor/                    Local icons, QR code generator, jsQR decoder (no CDN)
tools/local-server.mjs       Local preview (npm run local)
tools/build-icons.mjs, tailwind/   Only for design changes: npm run build
```

## How data is stored (Netlify Blobs, store "cuva")
`users/…`, `events/…`, `regs/{event}/{student}`, `myregs/…`, `tokens/…`, `config/…`.
Each registration is its own record, so students can never overwrite each other.
Seats are protected twice: an atomic seat counter, plus a check after saving that rolls back anything over the quota before the student is answered.

## Security summary
- Passwords hashed with scrypt + per-user salt; HttpOnly, SameSite login cookies (14 days), signed with a secret key.
- All permissions are checked on the server; organizer data never reaches students.
- An account is locked for 15 minutes after 10 wrong passwords.
- All user text is HTML-escaped. Strict security headers (CSP, no framing). Cross-site writes are blocked.
- All times are stored in UTC and shown in China Standard Time (UTC+8) for everyone.

## Notes
- **Access from mainland China:** Netlify has no servers inside mainland China, so the site may load slowly or unreliably for some students there. Test it on campus Wi-Fi and mobile data before an event.
- **Usage:** keep an eye on function and Blobs usage in your Netlify dashboard; a student club stays small, but limits depend on your plan.
