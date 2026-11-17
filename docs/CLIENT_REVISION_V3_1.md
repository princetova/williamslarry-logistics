# WilliamsLarry Logistics — client revision V3.1

## What changed

1. **Homepage:** Retained the existing headline, strengthened the description for customer/business positioning, updated the quote CTA, and used the real WilliamsLarry rider photograph in the hero. Added a compact, genuine-company photo feature below the ticker.
2. **Services:** Preserved the six existing services and their enquiry actions. Replaced relevant AI images with actual WilliamsLarry photos for Payment on Delivery, Regional Waybill Services, and Waybill Pickup & Delivery. Added concise benefits beneath each description.
3. **Illustrative images:** Haulage, warehousing and relocation still use concept imagery because no real photos of those operations were supplied. Each is clearly labelled `ILLUSTRATIVE IMAGE`. Replace those as soon as real photos are available.
4. **Delivery speed enquiries:** Added distinct **Express**, **Same-day**, and **Economy** enquiry cards, clearly marked as subject to confirmation. **These are NOT promises that such delivery services are currently available.** The client must explicitly confirm availability, coverage, deadlines, and rates before selling any delivery tier.
5. **About:** Added a real-company photography gallery featuring staff, bikes and the workspace (no invented office address).
6. **Backend:** Extended the accepted enquiry-service values so new enquiry types pass client- and server-side validation. Existing email and WhatsApp notification logic is unchanged. No live provider integrations have been enabled here.
7. **Preserved:** Existing homepage motion, logistics videos, glass effects, brand palette, navigation, contact page, tracking prototype, and all original route/quote form fields.

## Photos and business data requiring client review

- The photos are **client-provided**, not generated or retouched. The live website uses compressed WebP copies; the originals were not modified.
- Some rider box photographs have **different printed phone numbers** from the website's current phone `09038704667`. Confirm whether these are valid additional company numbers before publication. Do not change website contact numbers just because they appear in a photo.
- Obtain confirmation/permission for public promotional use of photographs featuring staff.
- For nationwide household relocation, warehousing, regional waybills and the three delivery-speed enquiries, confirm actual operational availability and coverage before launch. Do not claim guaranteed times, rates or performance.
- The business email `info@williamslarrylogistics.com` is separate from outbound notification delivery: Cloudflare still needs live serverless provider secrets and a functioning binding to send actual notifications.

## Deploy updated source (GitHub Desktop)

1. **Make a backup** of the currently working Git repository before copying files.
2. Extract `WilliamsLarry_Logistics_Client_Updates_V3_1.zip`. Copy all the extracted **contents** into the root of your local `williamslarry-logistics` Git checkout. Keep `public/` and `functions/` at repository root.
3. For a non-public preview, create a branch such as `feature/client-photos-services`; commit `Add real company photos and clarify services`; push the branch.
4. Review the Cloudflare preview deployment. Click each of the 6 existing enquiry buttons and the 3 new delivery-option enquiry buttons, check mobile, and verify all images and videos.
5. After the client approves the preview, merge into `main`. Cloudflare will automatically deploy the updated branch to production.
6. **Do not change Namecheap nameservers or email DNS** to deploy a website content update.

## Checks completed

- `node --test tests/*.test.js` — 9 tests passing, including new speed category validation.
- Reviewed homepage, Services and About desktop and mobile HTML in a browser renderer; no horizontal overflow or JavaScript page errors. Original page links and asset references resolve in the package.
- Live Cloudflare deployment and external email/WhatsApp delivery were **not** changed or tested.
