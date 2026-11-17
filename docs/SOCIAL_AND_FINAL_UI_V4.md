# WilliamsLarry Logistics – V4 UI refurbishment

## Live social links
Instagram: https://www.instagram.com/williamslarry_logistics/
TikTok: https://www.tiktok.com/@williamslarrylogistics (client-supplied profile link; share tracking parameters omitted).

## Design refresh
- Global refinements to navigation, hero layouts, service grids, photography, typographic scale, spacing, backgrounds, interactive states and mobile treatment.
- Genuine photos from the client's supplied materials; no AI-created face represents the owner. A modest documentary image uses an unmodified crop from the original owner video still (quality reflects source).
- New homepage trust strip and operational photography showcase; restored truthful, non-speculative route language.
- Instagram links in top navigation, footer, and Contact page.
- Preserve quote/contact/track interactivity and Cloudflare Pages Function backend as-is.

## What is not yet finished technically
- Complete the email sender configuration and WhatsApp Cloud API, and test actual notification delivery.
- Tracking remains a clearly labelled preview with human contact handoff.
- Confirm same-day/express availability before offering guarantees.
- Verify mobile and keyboard navigation and run post-deployment QA before declaring production ready.

## How to deploy
Upload the CONTENTS of this archive to the root of the GitHub repository (public/ and functions/ at root), or merge changed files on a branch. Cloudflare Pages build preset None; command exit 0; output public. No API secrets in Git. Test a branch deployment before merging main.


## V4.1 client footer correction
- Footer contact strip is flush and visually connected to the footer body; no top float or rounded outer card.
- The WhatsApp and phone contact subcontainers (including Contact page cards) have square 0px corners; keep the dotted circular icons.

## V4.2 final social update
- Replaced the former TikTok placeholders with working profile links across the five page footers and Contact page; added a matching desktop header icon.
- Preserved V4.1 footer styling and the existing backend. No live credentials are included.
