import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const pages = ['index.html', 'about.html', 'services.html', 'contact.html', 'track-shipment.html'];
const helperSource = await readFile('public/scripts/wll-whatsapp-followup.js', 'utf8');
const siteSource = await readFile('public/scripts/site.js', 'utf8');
const cssSource = await readFile('public/styles/wll-whatsapp-followup.css', 'utf8');

function loadHelper() {
  const context = {console};
  vm.createContext(context);
  vm.runInContext(helperSource, context);
  return context.WLLWhatsAppFollowup;
}

function resultHarness() {
  const links = [];
  const message = {textContent: ''};
  const result = {
    ownerDocument: {
      createElement(tag) {
        assert.equal(tag, 'a');
        return {isConnected: true, hidden: true, setAttribute() {}};
      },
    },
    querySelector(selector) {
      if (selector === 'p') return message;
      if (selector === '.wll-wa-followup-link') return links[0] || null;
      return null;
    },
    appendChild(link) { links.push(link); },
  };
  return {links, message, result};
}

test('every public enquiry page loads the helper once and before the existing site handler', async () => {
  for (const page of pages) {
    const html = await readFile(`public/${page}`, 'utf8');
    assert.equal((html.match(/\/styles\/wll-whatsapp-followup\.css/g) || []).length, 1, page);
    assert.equal((html.match(/\/scripts\/wll-whatsapp-followup\.js/g) || []).length, 1, page);
    assert.ok(html.indexOf('/scripts/wll-whatsapp-followup.js') < html.indexOf('scripts/site.js'), page);
  }
});

test('contact copy describes click-to-chat without claiming an automatic WhatsApp notification', async () => {
  const html = await readFile('public/contact.html', 'utf8');
  assert.match(html, /WhatsApp opens with a prefilled message that you must send yourself/i);
  assert.doesNotMatch(html, /notify the WilliamsLarry team on WhatsApp once our notification service is activated/i);
});

test('existing enquiry handler keeps one POST and invokes handoff only for email acceptance', () => {
  assert.equal((siteSource.match(/fetch\('\/api\/enquiry'/g) || []).length, 1);
  assert.match(siteSource, /payload\.channels\?\.email === 'accepted'/);
  assert.match(siteSource, /payload\.channels\?\.email !== 'accepted'/);
  assert.doesNotMatch(siteSource, /channels\?\.whatsapp !== 'accepted'/);
  assert.match(siteSource, /WLLWhatsAppFollowup\?\.onEmailAccepted/);
  assert.ok(siteSource.indexOf('cancelPending?.(result)') < siteSource.indexOf("fetch('/api/enquiry'"));
  assert.ok(siteSource.indexOf('onEmailAccepted({payload') > siteSource.indexOf('if (!response.ok'));
});

test('a repeated submission replaces its timer and a later failed attempt can cancel navigation', () => {
  const api = loadHelper();
  const {links, result} = resultHarness();
  const timers = new Map();
  const assigned = [];
  let nextTimer = 0;
  const browserWindow = {
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    location: {assign(url) { assigned.push(url); }},
  };
  const payload = {ok: true, reference: 'WL-8FB305AE06', channels: {email: 'accepted'}};
  const formData = {get(name) { return {sender: 'Test Customer', sender_phone: '08000000000'}[name] || null; }};

  assert.equal(api.onEmailAccepted({payload, formData, result, browserWindow}), true);
  assert.equal(api.onEmailAccepted({payload, formData, result, browserWindow}), true);
  assert.equal(links.length, 1);
  assert.equal(timers.size, 1);

  assert.equal(api.cancelPending(result, browserWindow), true);
  assert.equal(timers.size, 0);
  assert.equal(links[0].hidden, true);
  assert.deepEqual(assigned, []);
});

test('fallback link is visible, keyboard focusable and explicitly asks the customer to continue', () => {
  const api = loadHelper();
  const {links, message, result} = resultHarness();
  const browserWindow = {
    setTimeout() { return 1; },
    clearTimeout() {},
    location: {assign() {}},
  };
  const payload = {ok: true, reference: 'WL-8FB305AE06', channels: {email: 'accepted'}};

  assert.equal(api.onEmailAccepted({payload, formData: {get() { return null; }}, result, browserWindow}), true);
  assert.equal(links[0].textContent, 'Continue on WhatsApp');
  assert.equal(links[0].target, '_self');
  assert.equal(links[0].hidden, false);
  assert.match(message.textContent, /please tap Send there/i);
  assert.match(cssSource, /min-height:\s*44px/);
  assert.match(cssSource, /:focus-visible/);
  assert.match(cssSource, /prefers-reduced-motion:\s*reduce/);
});
