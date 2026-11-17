# WilliamsLarry Logistics — V4.2 social links and final UI

**Current project:** responsive, five-page business website prepared for Cloudflare Pages deployment.  
**Status:** UI refurbishment complete for review; **NOT** confirmation that the enquiry integrations or shipment tracking are live.

## V4.2 — TikTok activation

- Official TikTok profile supplied by the client: `https://www.tiktok.com/@williamslarrylogistics`.
- Active links replace all TikTok placeholders, including every page footer, the Contact social section and a desktop header icon.
- V4.1 footer geometry, photos and enquiry backend are preserved.

## V4.1 — Requested footer refinements

- The black footer and its contact strip now visually connect without the detached top gap.
- WhatsApp and Call Us links inside the strip have sharp rectangular corners, as do the direct contact cards on Contact.
- The dotted circular orbit surrounding each icon is intentionally retained.
- No other page sections, brand colors, services, photos, enquiry logic or animations were changed.

## What's new in V4

- Cohesive electric blue `#007BFF`, yellow `#FFEA00`, white and black visual system, applied across all five pages.
- Rebalanced typography, responsive navigation, image-led homepage, service cards, whitespace, consistent buttons and focus states.
- Authentic company photographs from the client's materials, without generated or replaced faces.
- New genuine-company proof ribbon, behind-the-scenes presentation and people-first gallery.
- Instagram on header, Contact page and footer: `https://www.instagram.com/williamslarry_logistics/`.
- TikTok is now linked to the client-supplied profile (V4.2).
- Honest shipment tracking notice: no invented status results, pricing, routes, response guarantees, staff counts or services.
- Quote/contact forms and Cloudflare Function preserved. No credentials added.

## Source tree

```text
public/
  index.html / about.html / services.html / contact.html / track-shipment.html
  styles/
    01-foundation.css               Shared brand primitives
    02-homepage.css                 Home layout
    03-inner-pages.css              Inner page layouts
    04-visual-refinements.css       Existing design treatments
    05-services-and-contact.css     Services and contact details
    06-email-feedback.css           Form feedback
    07-service-imagery.css          Image hovers
    08-authentic-company.css        Genuine company photos
    09-2026-final-ui.css            Final unified UI refinement
  scripts/site.js                   Navigation, modal, forms, motion, tracking message
  assets/                           Images and video
  _routes.json / _headers
functions/api/enquiry.js            Cloudflare Pages Function, separate from UI
docs/
  SOCIAL_AND_FINAL_UI_V4.md
  DEPLOY_CLOUDFLARE.md
  CLIENT_REVISION_V3_1.md
tests/enquiry.test.js
package.json
```

## Running the UI on your computer

From the **project root**, serve the public folder, e.g.:

```bash
python -m http.server 8000 --directory public
```

Then open `http://localhost:8000/` in a browser. Local static preview does **not** run `/api/enquiry`.

## Deploying to Cloudflare Pages

- Keep `public/` and `functions/` at the **GitHub repository root**.
- Project: `williamslarry-logistics` | Production branch: `main`
- Framework preset: `None` | Build command: `exit 0` | Output directory: `public`.
- Use a feature branch and confirm Cloudflare's preview deployment before merging to `main`.
- Maintain **Namecheap Private Email MX / SPF / DKIM / DMARC** records when connecting the domain.
- Never commit secrets. Complete email provider setup, Meta WhatsApp setup, and Cloudflare KV binding before accepting website enquiry forms publicly.
- The official company email is `info@williamslarrylogistics.com` and the client supplied phone is `09038704667`.

## Backend limitations

A `9/9` result from `npm test` validates simulated request handling only. It **does not verify** successful real-world delivery to the business inbox or WhatsApp account. These integrations require credentials, external provider configuration and an end-to-end test.

Shipment tracking is a preview, not a connected tracking database. Prices, coverage and delivery speeds need client confirmation. Some old illustrative assets and videos may have third-party usage restrictions; review licences before final publication.
