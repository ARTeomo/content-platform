# Meta App Setup Runbook

Step-by-step guide for connecting a Facebook Page to the Content Platform
webhook pipeline. Written from the actual setup experience in
September 2026, including every trap we hit.

This document is written to be **repeatable for additional Pages and
profiles**. Every value you need to fill in is called out as `<PLACEHOLDER>`.

---

## Audience

The operator performing a one-time Meta integration setup for a new Page,
or rotating credentials on an existing Page.

## Estimated time

| Path                                        | Time          |
| ------------------------------------------- | ------------- |
| First-time setup (fresh Business portfolio) | 3–4 hours     |
| Additional Page on an existing App          | 30–45 minutes |
| Credential rotation only                    | 10 minutes    |

## Prerequisites

| Item                                                         | Where to get it                                         |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Facebook account                                             | https://facebook.com                                    |
| Meta Business Suite access                                   | https://business.facebook.com                           |
| Meta for Developers account                                  | https://developers.facebook.com (same personal account) |
| ngrok account (free)                                         | https://dashboard.ngrok.com/signup                      |
| A running `apps/api` and `apps/worker`                       | see `local-development.md`                              |
| PostgreSQL `DATABASE_URL` and `WEBHOOK_TOKEN_ENCRYPTION_KEY` | the `.env` file                                         |

---

## Part 1 — Business portfolio and Page

### 1.1 Create a Business portfolio

Skip if you already have one.

1. Go to https://business.facebook.com
2. **Create Account** → Business portfolio
3. Name it (e.g., `Content Platform`), enter your name and business email

The **Business portfolio ID** will appear in the URL after creation:
`https://business.facebook.com/latest/home?business_id=<BUSINESS_ID>`

Record it. It is not secret.

### 1.2 Add or create a Facebook Page

Skip if you already have a Page you want to use.

**Create a new Page:**

1. https://www.facebook.com/pages/create
2. Name, Category, Description
3. After creation, go to Business Suite → Settings → Business Assets → Pages → **Add** → select the Page

**The business portfolio must own the Page.** Without this, the System
User and the App cannot access it.

### 1.3 Record the Page ID

The **numeric Page ID** (e.g., `1287488901121523`) is what the webhook
pipeline uses. It is **not** the same as the Page username
(`contentplatform.dev`) or the Business asset ID.

**Finding the Page ID:**

**Option A — Page Transparency (recommended):**

1. Open the Page in a browser
2. Click `...` (three dots) → **Page Transparency**
3. The **Page ID** is displayed at the top

**Option B — Business Suite URL:**

1. Business Suite → Settings → Business Assets → Pages
2. Click the Page
3. The URL contains `asset_id=<PAGE_ID>`

Record this value. It becomes `destinations.external_id`.

---

## Part 2 — Meta App creation

### 2.1 Create the App

1. https://developers.facebook.com/apps → **Create App**
2. **App type**: `Business`
3. **App name**: e.g., `content-platform-dev`
4. **App contact email**: your email
5. **Business portfolio**: select the one created in Part 1

After creation, the Dashboard URL is:
`https://developers.facebook.com/apps/<APP_ID>/`

### 2.2 Record App ID and App Secret

**App Settings → Basic** (top of the left sidebar):

| Field          | Notes                                              |
| -------------- | -------------------------------------------------- |
| **App ID**     | Not secret. Safe to commit to config.              |
| **App Secret** | **Secret.** Click **Show** and copy. Never commit. |

**Security note:** the App Secret is the HMAC key for webhook signature
verification. If it ever appears in a chat, a log, or a screenshot,
**rotate immediately** via **Reset** on the same page.

### 2.3 Add the Webhooks product

Left sidebar → **Add Product** → **Webhooks** → **Set Up**.

This adds a **Webhooks** entry to the sidebar, which is where the
Callback URL is configured later (Part 4).

Do **not** configure the webhook yet — the API must be running first.

---

## Part 3 — Local tunnel (ngrok)

Skip this Part if `apps/api` is already deployed behind a public HTTPS
endpoint.

### 3.1 Install ngrok

Windows:

```powershell
winget install ngrok.ngrok
```

Or download from https://ngrok.com/download, extract, and add the folder
to `PATH`.

### 3.2 Authenticate

```powershell
ngrok config add-authtoken <NGROK_AUTHTOKEN>
```

Get the token from https://dashboard.ngrok.com/get-started/your-authtoken.

**Security note:** if the token is ever exposed, click **Regenerate** on
the same page and re-run `ngrok config add-authtoken`.

### 3.3 Start the tunnel

Make sure `apps/api` is listening on port 3000.

```powershell
C:\ngrok\ngrok.exe http 3000
```

Record the **Forwarding** URL:

```
Forwarding  https://<SUBDOMAIN>.ngrok-free.dev -> http://localhost:3000
```

The HTTPS URL is what the Meta dashboard needs.

**Trap:** the free ngrok URL changes on **every restart**. Every time
ngrok restarts, the Meta dashboard Callback URL must be updated. For
long-running development, either:

- Upgrade to a paid ngrok plan with a static domain, or
- Deploy `apps/api` to a stable HTTPS endpoint

---

## Part 4 — Webhook verification

### 4.1 The verify token

This is a **shared secret that you invent**. It is not issued by Meta.
Pick something memorable but not guessable:

```
<VERIFY_TOKEN>    e.g., content-platform-verify-2026
```

The **same value** must exist in two places:

1. Encrypted in `webhook_subscriptions.verify_token_encrypted` (via the
   seed script — see Part 5)
2. In the Meta dashboard Verify Token field (this Part)

If they don't match, Meta returns **HTTP 403** on the handshake.

### 4.2 Configure the Callback URL

Meta App Dashboard → **Webhooks** (left sidebar) → **Page** tab:

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| **Callback URL** | `https://<SUBDOMAIN>.ngrok-free.dev/api/v1/webhooks/meta` |
| **Verify Token** | `<VERIFY_TOKEN>` from step 4.1                            |

Click **Verify and save**.

### 4.3 What happens behind the scenes

1. Meta sends `GET /api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=<RANDOM>`
2. `apps/api` iterates all `webhook_subscriptions` rows where
   `provider = 'META' AND status = 'ACTIVE'`
3. For each row, it decrypts `verify_token_encrypted` using
   `WEBHOOK_TOKEN_ENCRYPTION_KEY`, with AAD `META:<destination_id>`
4. On match, it returns `<RANDOM>` as `text/plain` and updates
   `last_verified_at`
5. On mismatch, it returns HTTP 403

**Trap:** if `webhook_subscriptions` has **no row** yet, the loop is
empty and the handshake always fails with 403. Insert the row first
(Part 5) before clicking Verify and save.

**Trap:** the Meta dashboard sometimes does not refresh the "Verify and
save" state after a successful handshake. Reload the page (F5) to see
the **Webhook fields** table populate.

### 4.4 Confirm the handshake works from the command line

Before relying on the dashboard, verify the endpoint responds correctly:

```bash
curl -i "https://<SUBDOMAIN>.ngrok-free.dev/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=test123"
```

Expected:

```
HTTP/1.1 200 OK
Content-Type: text/plain
...
test123
```

If this fails, the Meta dashboard will also fail. Fix the endpoint
before touching the dashboard again.

---

## Part 5 — Database records

Two rows must exist before the handshake can succeed:

1. `destinations` — representing the Page
2. `webhook_subscriptions` — with the encrypted verify token

### 5.1 Run the seed script

From the repository root:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
export WEBHOOK_TOKEN_ENCRYPTION_KEY="$(grep '^WEBHOOK_TOKEN_ENCRYPTION_KEY=' .env | cut -d= -f2-)"

node packages/database/scripts/seed-webhook-subscription.mjs \
  --page-id <PAGE_ID> \
  --page-name "<PAGE_NAME>" \
  --verify-token "<VERIFY_TOKEN>"
```

Expected output:

```
[seed] destination created: <DESTINATION_UUID>
[seed] subscription ready for destination <DESTINATION_UUID>
[seed] verify token (paste into Meta dashboard): <VERIFY_TOKEN>
```

Record `<DESTINATION_UUID>` — it is used by the worker during processing.

The script is **idempotent**: re-running it updates the existing rows.

### 5.2 Verify with the inspection script

```bash
node packages/database/scripts/inspect-db.mjs
```

Expected: one row in `webhook_subscriptions` with `status = 'ACTIVE'`.

---

## Part 6 — System User (stable access token)

A System User provides a Page access token that does not depend on your
personal Facebook account, and it does not expire when you log out.

### 6.1 Create the System User

1. Business Suite → **Settings** → **Users** → **System Users**
2. **Add** → Name: e.g., `contentplatform-bot`
   - **Trap:** the name field rejects `-` (dashes) in some regions.
     Use `contentplatformbot` if `contentplatform-bot` is rejected.
3. Role: **Admin**

### 6.2 Assign assets

On the System User detail page, click **Assign Assets** (or the `...`
menu if the button is hidden).

**Assign both:**

| Asset type | Value           | Permission       |
| ---------- | --------------- | ---------------- |
| **Pages**  | the target Page | **Full Control** |
| **Apps**   | the Meta App    | **Full Control** |

**Trap:** the assign-assets panel may open with the wrong tab. Use the
**left sidebar** in the panel to switch between "Facebook Pages",
"Applications", and other asset types.

**Trap:** if the "Assign Assets" button is not visible, the URL
`https://business.facebook.com/settings/system_users?business_id=<ID>&selected_user_id=<ID>`
may not load the correct state. Use the left-side navigation
**Rendszerfelhasználók** → click the user's name instead.

### 6.3 Generate the token

On the System User detail page:

1. **Generate Token** (or **Kód létrehozása**)
2. **App**: the Meta App
3. **Token duration**: `60 days` (sufficient for development; the
   production token can be `Never expires` if your policy allows)
4. **Permissions** — check all of:
   - `pages_manage_metadata`
   - `pages_read_engagement`
   - `pages_show_list`
   - `business_management` (if available)
5. Click **Generate**

**Copy the token immediately.** It is shown only once.

**Trap:** the System User token does **not** appear in the
Graph API Explorer "User or Page" dropdown. Paste it directly into the
**Access Token** field instead.

**Security note:** never commit the token to the repository. Store it in
`.env` as `META_PAGE_ACCESS_TOKEN` for scripts, or paste it into the
Graph API Explorer only for the current session.

---

## Part 7 — Page-to-App subscription

This is a **separate step** from the webhook verification. Verify and
Save only confirms the App's ability to receive webhooks. The Page must
**also** be subscribed to the App.

### 7.1 Check current subscription

Graph API Explorer:
`https://developers.facebook.com/tools/explorer/`

- Paste the System User token into the **Access Token** field
- Request:

```
GET  v26.0  /<PAGE_ID>/subscribed_apps
```

Expected (if subscribed):

```json
{
  "data": [{ "name": "content-platform-dev", "id": "<APP_ID>" }]
}
```

If `data` is empty, continue to 7.2.

### 7.2 Subscribe the Page to the App

**Trap:** this is a `POST`, not a `GET`. The Graph API Explorer is not
obvious about this.

Fastest way — paste this URL directly in the browser:

```
https://developers.facebook.com/tools/explorer/?method=POST&path=<PAGE_ID>%2Fsubscribed_apps&version=v26.0&subscribed_fields=feed%2Cmention
```

Replace `<PAGE_ID>` with the numeric Page ID.

Then:

1. Make sure the **Access Token** field still contains the System User token
2. Click **Submit**

Expected response:

```json
{ "success": true }
```

### 7.3 Subscribe to individual fields in the dashboard

The `subscribed_apps` call attaches the App to the Page. But the
**specific fields** (`feed`, `mention`) are subscribed in the dashboard.

Meta App Dashboard → Webhooks → Page → **Webhook fields** table:

| Field     | Action                          |
| --------- | ------------------------------- |
| `feed`    | Toggle to **Subscribed** (blue) |
| `mention` | Toggle to **Subscribed** (blue) |

**Trap:** the table may not appear until the handshake succeeded
(Part 4). If the handshake failed, fix it first.

---

## Part 8 — Switch App to Live mode

**This is the single most important step.** In **Development** mode,
Meta does not deliver **any** real webhook events — not from app admins,
not from developers, not from testers. Only the dashboard "Test" button
works, and it sends dummy data (see Part 9.1).

The dashboard states this explicitly in a red warning:

> "Apps will only be able to receive test webhooks sent from the
> dashboard while the app is unpublished. No production data, including
> from app admins, developers or testers, will be delivered unless the
> app has been published."

### 8.1 Required fields

Live mode requires **three** values, all in **App Settings → Basic**:

**Privacy Policy URL**

The fastest path is a public GitHub Gist:

1. https://gist.github.com
2. Filename: `privacy-policy.md`
3. Paste a minimal privacy policy (see Appendix A)
4. **Create public gist**
5. Copy the Gist URL (e.g., `https://gist.github.com/<user>/<id>`)
6. Paste into the **Privacy Policy URL** field

**App Icon**

Requirements: 1024×1024, transparent background, JPG/PNG/GIF, max 5 MB.

**Trap:** the Meta App Icon uploader rejects non-transparent backgrounds.
If you only have a JPG with a white background, generate a transparent
PNG with PowerShell (see Appendix B).

**Category**

Any value works. `News and Media` or `Business and Pages` are reasonable.

### 8.2 Save and toggle

1. **Save changes** at the bottom of App Settings → Basic
2. Return to the App Dashboard: `https://developers.facebook.com/apps/<APP_ID>/`
3. Top-left: **App Mode: Development** toggle → click → **Live**

If the App Mode toggle shows a red error, one of the three required
fields is invalid. Read the exact error text.

---

## Part 9 — Verification

### 9.1 The dashboard "Test" button sends dummy data

Meta App Dashboard → Webhooks → Page → any field → **Test** → **Send
to server v<version>**.

**Trap:** the test payload uses `entry[0].id = "0"` as the Page ID.
Because the ingress resolves `destinations.external_id = "0"`, the
destination lookup fails and the event ends with
`UNKNOWN_DESTINATION`. This is expected behaviour — the test button
exercises the HTTP path but not the destination resolution.

### 9.2 Real end-to-end test

The real test requires a **real user action** on the Page.

1. Log in to Facebook with a **personal profile** (not the Page)
2. Open the Page: `https://www.facebook.com/<page-username>/`
3. Open a post
4. Write a comment

Within 5–30 seconds:

- `webhook_events` gains a row with `external_object_id = <PAGE_ID>`,
  `status = 'PROCESSED'`
- `outbox_jobs` gains a row with `status = 'DISPATCHED'`
- `external_interactions` gains a row with
  `interaction_type = 'COMMENT'` and the comment text

Verify with:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
node packages/database/scripts/inspect-db.mjs
```

The worker terminal should also log:

```
[webhook.process] event <uuid> processed: 1 interactions
```

### 9.3 What "status" events look like

A Page's own post creation sends a `feed` event with `item: "status"`.
The `FeedChangeExtractor` skips these (they are not inbound
interactions). You will see:

```
[webhook.process] event <uuid> processed: 0 interactions
```

This is correct. `webhook_events.status = 'PROCESSED'` is still expected.

---

## Appendix A — Minimal Privacy Policy

Copy this into the Gist, replacing the placeholder values:

```markdown
# Privacy Policy

**Last updated:** YYYY-MM-DD

## What this application does

<App name> is a content automation tool operated by <operator name>. It
aggregates publicly available content from public sources and publishes
curated summaries to a Facebook Page owned by the operator.

## What data we collect

- Publicly available content from configured sources.
- Public interactions on the operator's own Facebook Page (comments,
  reactions, mentions) received via the Meta Webhooks API.
- The public profile name and public user ID of users who interact with
  the operator's Facebook Page.

We do not collect private messages, private user data, passwords, email
addresses, or phone numbers.

## How we use the data

Data received through the Meta Webhooks API is used to display and
manage interactions on the operator's Facebook Page, optionally generate
automated responses to public comments, and monitor the technical health
of the integration. Data is stored in a private database accessible only
to the operator.

## Data retention

Data is retained as long as required for the operation and deleted when
no longer needed.

## Data sharing

We do not sell, rent, or share any collected data with third parties.

## User rights

Users can request information about, or deletion of, their interaction
data by contacting the operator below.

## Contact

<operator name>
Email: <operator email>

## Changes

The latest version is always available at this URL.
```

---

## Appendix B — Generate a transparent App Icon (Windows PowerShell)

Run this in PowerShell:

```powershell
Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 100, 200))
$g.FillEllipse($brush, 100, 100, 824, 824)

$font = New-Object System.Drawing.Font("Arial", 500, [System.Drawing.FontStyle]::Bold)
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
$g.DrawString("C", $font, $whiteBrush, $rect, $format)

$g.Dispose()
$outPath = "$env:USERPROFILE\Desktop\app-icon.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Saved: $outPath"
```

The result is a 1024×1024 PNG with a transparent background.

---

## Reference — current Content Platform setup

Recorded here for continuity. **Secrets are not listed.**

| Item                  | Value                 |
| --------------------- | --------------------- |
| Meta App ID           | `915404831335846`     |
| Meta App Mode         | **Live**              |
| Business portfolio ID | `1416443380591994`    |
| Page ID               | `1287488901121523`    |
| Page username         | `contentplatform.dev` |
| System User           | `contentplatformbot`  |
| Subscribed fields     | `feed`, `mention`     |

Database records:

| Table                      | ID                                     |
| -------------------------- | -------------------------------------- |
| `destinations.id`          | `51eb5e79-b6a5-4f51-86bb-23dd81e9167e` |
| `webhook_subscriptions.id` | `2bc850b3-3e93-45d7-98cd-45e07a2daf00` |

---

## Troubleshooting quick reference

| Symptom                                                                | Likely cause                                                      | Fix                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Handshake returns 403                                                  | No `webhook_subscriptions` row, or verify token mismatch          | Run seed script with the exact dashboard value        |
| Handshake succeeds, but no real events arrive                          | App in Development mode                                           | Switch App to Live (Part 8)                           |
| Test button produces `FAILED / UNKNOWN_DESTINATION`                    | The Test payload uses `entry[0].id = "0"`                         | Expected; test with a real comment (Part 9.2)         |
| Real comment produces no webhook at all                                | Page not subscribed to App                                        | `POST /{page-id}/subscribed_apps` (Part 7)            |
| Real comment produces webhook but `item: "status"`                     | You are looking at the post-creation event, not the comment event | Scroll further in `webhook_events`                    |
| `subscribed_apps` returns empty array                                  | Page not subscribed                                               | Run the POST from Part 7.2                            |
| Graph API Explorer "User or Page" does not list the Page               | System User token not pasted in Access Token field                | Paste token directly, do not use the dropdown         |
| Live mode toggle shows red error                                       | Privacy Policy, App Icon, or Category missing                     | Complete all three in App Settings → Basic            |
| `error_subcode: 2069032` "Felhasználói hozzáférési kód nem támogatott" | Using User Access Token for a Page operation                      | Use Page Access Token or System User token            |
| ngrok URL changes on restart                                           | Free ngrok tier                                                   | Update Meta Callback URL, or use a paid static domain |

---

## Related documents

- [`local-development.md`](./local-development.md) — local PostgreSQL and Redis via cloud services
- [`../architecture/system-overview.md`](../architecture/system-overview.md) — the two-way Meta integration
- [`../../TECHNICAL_SPECIFICATION.md`](../../TECHNICAL_SPECIFICATION.md) §140 — webhook ingress contract
