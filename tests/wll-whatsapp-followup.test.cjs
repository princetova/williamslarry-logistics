'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync('public/scripts/wll-whatsapp-followup.js', 'utf8');
const context = { setTimeout, clearTimeout, console };
vm.createContext(context);
vm.runInContext(source, context);
const api = context.WLLWhatsAppFollowup;
const ref = 'WL-8FB305AE06';
function form(fields) { return { get: name => fields[name] ?? null }; }
const data = form({sender:'Williams Larry Test', sender_phone:'07072055517',service:'Furniture Arrangement', pickup:'private location'});

test('uses BOSS phone number, not test customer, and preserves enquiry reference', () => {
  const result = api.buildWhatsAppUrl({ reference: ref, formData: data });
  const url = new URL(result);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/2349038704667');
  assert.match(url.searchParams.get('text'), /Reference: WL-8FB305AE06/);
  assert.match(url.searchParams.get('text'), /Name: Williams Larry Test/);
  assert.match(url.searchParams.get('text'), /My phone: 07072055517/);
  assert.doesNotMatch(url.searchParams.get('text'), /private location/);
});

test('contact enquiry is identified and special characters are safely URL encoded', () => {
  const url = new URL(api.buildWhatsAppUrl({reference:ref,source:'contact',formData:form({sender:'A & B',service:'Bulk Delivery'})}));
  assert.match(url.searchParams.get('text'), /contact enquiry/);
  assert.match(url.searchParams.get('text'), /A & B/);
  assert.ok(url.href.includes('A%20%26%20B'));
});

test('rejects unverified references instead of fabricating success', () => {
  assert.throws(() => api.buildWhatsAppUrl({reference:'TEST',formData:data}), /verified/);
});

test('does nothing when email is not accepted', () => {
  const node = {appendChild(){throw Error('must not append');}};
  assert.equal(api.onEmailAccepted({payload:{ok:true,reference:ref,channels:{email:'failed',whatsapp:'accepted'}},formData:data,result:node}), false);
  assert.equal(api.onEmailAccepted({payload:{ok:false,reference:ref,channels:{email:'accepted'}},formData:data,result:node}), false);
});

test('after email acceptance, shows fallback link and schedules same-tab WhatsApp navigation', () => {
  const links = [];
  const para = {textContent:''};
  const fakeLink = {isConnected:true,setAttribute(){},hidden:true};
  const result = {
    ownerDocument:{createElement(tag){assert.equal(tag,'a');return fakeLink;}},
    querySelector(selector) { return selector==='p' ? para : links[0] || null; },
    appendChild(el){links.push(el);}
  };
  let callback; let delay;
  const browserWindow = {
    setTimeout(fn,ms){callback=fn;delay=ms;return 1;},
    clearTimeout(){},
    location:{assign(url){ this.assigned = url; }}
  };
  const success = {ok:true,reference:ref,channels:{email:'accepted',whatsapp:'not_configured'}};
  assert.equal(api.onEmailAccepted({payload:success,formData:data,source:'quote',result,browserWindow}),true);
  assert.equal(links.length,1);
  assert.equal(delay,900);
  assert.match(para.textContent, /Opening WhatsApp/);
  assert.match(fakeLink.href, /^https:\/\/wa.me\/2349038704667\?/);
  callback();
  assert.equal(browserWindow.location.assigned, fakeLink.href);
});
