import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequestPost } from '../functions/api/enquiry.js';

const approved = [
  "Relocation Services",
  "Premium Relocation",
  "Economy Relocation",
  "Residential & Office Moving",
  "Pickup & Delivery",
  "Economy Delivery",
  "Express Delivery",
  "Same-Day Delivery",
  "Scheduled Delivery",
  "Handling & Assistance",
  "Loading & Offloading",
  "Indoor Placement",
  "Furniture Arrangement",
  "Moving Assistance",
  "Packaging & Preparation",
  "Packing Assistance",
  "Protective Packaging",
  "Wrapping & Shipment Preparation",
  "Special Logistics",
  "Bulk Delivery",
  "Business Logistics",
  "E-commerce Delivery",
  "Dedicated Transport"
];
const pages = ['index.html','services.html','about.html','contact.html','track-shipment.html'];

test('all enquiry forms offer every approved service and no legacy service options', async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../public/${page}`, import.meta.url), 'utf8');
    const forms = [...html.matchAll(/<select name="service">([\s\S]*?)<\/select>/g)];
    assert.equal(forms.length, page === 'contact.html' ? 2 : 1, page);
    for (const [, options] of forms) {
      const values = [...options.matchAll(/<option>([^<]*)<\/option>/g)].map(m => m[1].replaceAll('&amp;', '&'));
      assert.deepEqual(values, [...approved,'Other / Not sure'], page);
    }
  }
});

test('all catalogue selections are accepted by validated enquiry API', async () => {
  for (const service of approved) {
    const body = { sender:'Synthetic Sender',sender_phone:'09030000000',pickup:'Owerri',receiver:'Synthetic Receiver',receiver_phone:'08010000000',destination:'Aba',items:'Box',service,source:'quote' };
    const request = new Request('https://williamslarrylogistics.com/api/enquiry',{method:'POST',headers:{'content-type':'application/json',origin:'https://williamslarrylogistics.com'},body:JSON.stringify(body)});
    const env = {ENQUIRY_KV:{get:async()=>null,put:async()=>{}}};
    const response = await onRequestPost({request,env});
    // No providers configured: valid selections reach the notification availability guard.
    assert.equal(response.status,503,service);
    assert.match((await response.json()).message,/contact us/i);
  }
});

test('home links and quote buttons match the new catalogue', async () => {
  const home = await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const services = await readFile(new URL('../public/services.html',import.meta.url),'utf8');
  assert.ok(!home.includes('team-operations-original.webp'));
  assert.match(home,/class="documentary-photo"[^\n]*courier-at-work\.webp/);
  const links = [...home.matchAll(/class="service-tile [^"]*" href="services.html#([^"]+)"/g)].map(m=>m[1]);
  assert.equal(links.length,5);
  for (const slug of links) assert.ok(services.includes(`id="${slug}"`),slug);
  const buttons = [...services.matchAll(/data-service="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;', '&'));
  assert.deepEqual(buttons,['Relocation Services','Pickup & Delivery','Handling & Assistance','Packaging & Preparation','Special Logistics']);
});
