import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const customerCareUrl = 'https://wa.me/message/KFHJJLJXSYVVE1';
const retiredUrl = 'https://wa.me/message/TUJVR6JED3FTB1';
const pages = ['index.html', 'about.html', 'services.html', 'contact.html', 'track-shipment.html'];

test('all public pages expose one accessible floating Customer Care control', async () => {
  for (const page of pages) {
    const html = await readFile(`public/${page}`, 'utf8');
    const floating = html.match(/<a[^>]*class="floating-whatsapp"[^>]*>[\s\S]*?<\/a>/g) || [];
    assert.equal(floating.length, 1, page);
    assert.match(floating[0], new RegExp(`href="${customerCareUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), page);
    assert.match(floating[0], /aria-label="Chat with WilliamsLarry Customer Care on WhatsApp"/, page);
    assert.match(floating[0], /target="_blank"/, page);
    assert.match(floating[0], /rel="noopener noreferrer"/, page);
    assert.match(floating[0], /CUSTOMER CARE/, page);
  }
});

test('footer and relevant direct-support links use only the approved Customer Care destination', async () => {
  const expectedCounts = new Map([
    ['index.html', 2],
    ['about.html', 2],
    ['services.html', 2],
    ['contact.html', 3],
    ['track-shipment.html', 3],
  ]);
  for (const page of pages) {
    const html = await readFile(`public/${page}`, 'utf8');
    assert.equal(html.split(customerCareUrl).length - 1, expectedCounts.get(page), page);
    assert.doesNotMatch(html, new RegExp(retiredUrl), page);
    assert.match(html, /<span class="contact-method-label">CUSTOMER CARE<\/span><strong>Chat on WhatsApp<\/strong>/, page);
  }
  const contact = await readFile('public/contact.html', 'utf8');
  assert.match(contact, /contact-card-stack[\s\S]*?CUSTOMER CARE[\s\S]*?Chat on WhatsApp/);
  const tracking = await readFile('public/track-shipment.html', 'utf8');
  assert.match(tracking, /ASK CUSTOMER CARE ↗/);
});

test('Customer Care remains separate from the Phase 4D.1 dynamic enquiry handoff', async () => {
  const helper = await readFile('public/scripts/wll-whatsapp-followup.js', 'utf8');
  const site = await readFile('public/scripts/site.js', 'utf8');
  assert.match(helper, /BUSINESS_WHATSAPP_DIGITS = '2349038704667'/);
  assert.match(helper, /`https:\/\/wa\.me\/\$\{BUSINESS_WHATSAPP_DIGITS\}\?text=/);
  assert.doesNotMatch(helper, /KFHJJLJXSYVVE1/);
  assert.equal((site.match(/fetch\('\/api\/enquiry'/g) || []).length, 1);
  assert.match(site, /payload\.channels\?\.email === 'accepted'/);
  assert.match(site, /WLLWhatsAppFollowup\?\.onEmailAccepted/);
});

test('floating control has mobile collision, safe-area and reduced-motion protection', async () => {
  const css = await readFile('public/styles/09-2026-final-ui.css', 'utf8');
  assert.match(css, /body:has\(\.quote-dialog\[open\]\) \.floating-whatsapp/);
  assert.match(css, /body:has\(\.main-nav\.open\) \.floating-whatsapp/);
  assert.match(css, /body:has\(#contact-form:focus-within\) \.floating-whatsapp/);
  assert.match(css, /body:has\(#contact-result:not\(\[hidden\]\)\) \.floating-whatsapp/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[^{]*\{\.floating-whatsapp\{transition:none!important\}/);
});
