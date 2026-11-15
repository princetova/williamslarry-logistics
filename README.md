# WilliamsLarry Logistics — Cloudflare Pages edition (V3.0)

**Existing design preserved.** Converted the V2.7 PHP enquiry endpoint to a Cloudflare Pages Function with server-only Resend email and WhatsApp Cloud API transports. Intended recipient email: `info@williamslarrylogistics.com`. WhatsApp alert recipient: `2349038704667`. Customer-facing visuals (HTML, CSS, media) are unchanged; only the form endpoint and user-facing local-preview warning are updated.

## Structure

```text
public/                 Public HTML, CSS, JS, images and videos (deploy this folder)
  index.html
  about.html
  services.html
  contact.html
  track-shipment.html
  assets/               Existing files copied unchanged
  styles/               Seven existing CSS modules
  scripts/site.js       Existing interactions; form POST now /api/enquiry
  _routes.json          Avoid charging Functions requests for static assets
  _headers              Basic security/cache response headers
functions/api/enquiry.js  Server-only enquiry validation and provider notifications
docs/DEPLOY_CLOUDFLARE.md Setup instructions
.dev.vars.example     Empty local development placeholders; never upload actual secrets
package.json          Wrangler deploy / test commands
```

## Run tests

```bash
npm test
```

## Deploy (developer CLI)

1. Create a Cloudflare account belonging to the company; invite the developer as collaborator.
2. In the root folder, run:

```bash
npx wrangler login
npx wrangler pages project create williamslarry-logistics --production-branch=main
npx wrangler pages deploy public --project-name williamslarry-logistics
```

3. In Cloudflare dashboard, create a **Workers KV** namespace and bind it to Pages as **`ENQUIRY_KV`**. Redeploy for binding to take effect.
4. Configure **encrypted secrets** / environment variables described in `docs/DEPLOY_CLOUDFLARE.md`. Redeploy.
5. Test both delivery channels with approved provider credentials; until then enquiries will display a genuine failure and fallback to the WhatsApp contact link.
6. **Do not change the Namecheap domain's nameservers until all existing Private Email MX / SPF / DKIM / DMARC records are confirmed present in Cloudflare DNS.**
7. Connect the custom domain in Pages and test both HTTPS and mailbox send/receive again.

## Important limitations

- **No live website has been published from this package.** Cloudflare setup, credentials and DNS changes require the authorised account owner.
- **Existing Namecheap Private Email can receive mail; it does not automatically provide a website email-sending API.** Use a verified sending service/domain such as Resend separately.
- **WhatsApp alerts require an authorised Meta sender, an approved message template, billing where applicable, and the recipient's opt-in.** `09038704667` is the receiving number, not necessarily the sender.
- Cloudflare KV offers best-effort, *eventually consistent* duplicate/rate checks, not strict atomic transaction guarantees. Add Cloudflare Turnstile and a more robust rate limiter for high-risk public traffic.
- No booking, pricing, payment collection, or real-time tracking is claimed.
- Some existing imagery/videos came from third parties; verify commercial usage rights before public launch. Generated illustrative photos are not evidence of WilliamsLarry's actual fleet or facilities.
