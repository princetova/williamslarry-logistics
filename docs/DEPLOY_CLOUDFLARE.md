# Deployment checklist — Cloudflare Pages + Namecheap Private Email

## 1. Deploy without disturbing business email

- Make sure the Namecheap mailbox `info@williamslarrylogistics.com` can send **and** receive messages. Keep the existing Namecheap Private Email subscription.
- In Namecheap, open `williamslarrylogistics.com` (NOT `keystonebritish.org`) and record **all** current DNS records, especially `MX`, `TXT` (SPF/DMARC), `CNAME` (DKIM/autodiscover), and any custom mail records. Save screenshots.
- Set up Cloudflare and add `williamslarrylogistics.com` as a zone; inspect imported DNS records. **Manually reconcile missing records** against Namecheap before touching nameservers.
- Do **not** enable Cloudflare Email Routing; it would replace the existing mail MX routes. Non-web/mail host records should be DNS-only, not proxied.
- Upload website (steps 2–3), first using Cloudflare's temporary `pages.dev` URL; then attach `williamslarrylogistics.com` in **Workers & Pages → Project → Custom domains**. For the apex domain Cloudflare requires using its nameservers. Only then update the domain's nameservers at Namecheap, and verify email again after propagation.

## 2. Create the Pages project from VS Code terminal

Open the extracted **root** folder (the one containing `public` and `functions`). Install Node.js if needed. Then:

```powershell
npx wrangler login
npx wrangler pages project create williamslarry-logistics --production-branch=main
npx wrangler pages deploy public --project-name williamslarry-logistics
```

The `public` directory is the deployed static website. The sibling `functions/api/enquiry.js` becomes `/api/enquiry` during a **Wrangler** Pages deploy.

**Do not use drag-and-drop upload for this project**: drag-and-drop does not compile the `functions/` directory (unless using a different `_worker.js` integration). A pure static upload would make the homepage look correct while silently breaking the enquiry API.

## 3. Create and bind KV (anti-spam/dedup storage)

- Cloudflare dashboard → **Storage & databases / KV** (menu labels may vary): create a KV namespace such as `wll-enquiries`.
- Workers & Pages → `williamslarry-logistics` → Settings → Bindings → Add → **KV namespace** → variable name **`ENQUIRY_KV`** → choose the namespace → Save.
- Redeploy after adding the binding. Without `ENQUIRY_KV`, the enquiry endpoint correctly returns `503` rather than accepting messages without any controls.

This is a **best-effort** IP quota (5 submissions per 10-minute time window) and 3-minute duplicate prevention; Cloudflare KV is eventually consistent, not a true atomic limiter. Before launch consider Cloudflare Turnstile and WAF rules, especially if receiving spam.

## 4. Email — receive at Namecheap, send via Resend

The mailbox is already bought. Set up a **Resend** account to enable *website-initiated* sending. In Resend verify **`notify.williamslarrylogistics.com`** and copy the required DNS records into Cloudflare DNS exactly as provided. This sending subdomain avoids replacing the existing root-domain Private Email MX records. Resend and the mailbox serve different purposes.

Cloudflare → Pages → Project → Settings → **Variables and Secrets**: configure:

| Name | Type | Value |
|---|---|---|
| `RESEND_API_KEY` | **Secret** | From Resend dashboard; never commit |
| `EMAIL_ENABLED` | Plain text | `true` |
| `EMAIL_TO` | Plain text | `info@williamslarrylogistics.com` |
| `EMAIL_FROM` | Plain text | `WilliamsLarry Logistics <enquiries@notify.williamslarrylogistics.com>` |
| `RATE_LIMIT_PEPPER` | **Secret** | Random long value, different from all passwords |

The `EMAIL_FROM` address must belong to the exact domain verified in Resend. The mailbox receiving it remains `info@williamslarrylogistics.com`. Send a form test and verify receipt **before promising users that emails arrive**. Provider acceptance is not a delivery receipt.

## 5. WhatsApp — optional until Meta is ready

Add the following Pages variables/secrets when the boss approves live notifications:

| Name | Type | Value |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | **Secret** | Official WhatsApp Cloud API authorised sender token |
| `WHATSAPP_PHONE_NUMBER_ID` | Plain text | Sender phone number ID from Meta |
| `WHATSAPP_ALERT_TO` | Plain text | `2349038704667` (owner's opted-in WhatsApp recipient) |
| `WHATSAPP_TEMPLATE_NAME` | Plain text | `wll_new_enquiry` (must be approved by Meta) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Plain text | `en` or approved exact language |
| `WHATSAPP_GRAPH_VERSION` | Plain text | Check current supported Graph API version, e.g. `v27.0` |

The approved template must contain exactly **8 body placeholders** `{{1}}`–`{{8}}` in this order: reference, service, sender name/phone, pickup address, receiver name/phone, dropoff address, items, notes. The **sending number** and the **receiving WhatsApp number** are separate concepts. The boss's number should **not** be migrated without an explicit plan.

For now, email can run independently. The API will report which provider accepted a submission; it will not pretend WhatsApp worked when it is not configured.

## 6. Real end-to-end acceptance check

1. Visit the `pages.dev` preview on HTTPS.
2. Submit a test **Contact** enquiry and **Get a Quote** enquiry using non-sensitive dummy data.
3. Confirm success and reference only if Resend/Meta returned accepted provider IDs.
4. Check the company inbox for the email; check the owner's WhatsApp if configured. Confirm exactly one alert when a duplicate request is repeated.
5. Submit incomplete and invalid data; verify errors are shown and no notifications are sent.
6. Run all five navigation pages on phone and desktop; confirm video playback and service imagery.
7. Connect custom domain; test `https://williamslarrylogistics.com/` and `https://www.williamslarrylogistics.com/` as configured.
8. Re-test **Namecheap Private Email** receiving from Gmail and replying back after the nameserver change.
9. Do not publicly advertise working bookings, live tracking, or automated WhatsApp before real tests succeed.

## 7. Running locally

```powershell
copy .dev.vars.example .dev.vars
npx wrangler pages dev public --kv=ENQUIRY_KV
```

Add local test credentials only to `.dev.vars` (never commit). Local test sends can incur real provider activity; use test accounts and safe recipients. Opening `index.html` as `file:///` does not run the API.

**Cost:** Cloudflare Pages serves static assets free on its free plan. Pages Functions share Workers Free's daily request quota, and third-party email/WhatsApp provider charges may apply. Usage limits change; check the provider dashboards before production.
