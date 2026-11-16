import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost, onRequest} from '../functions/api/enquiry.js';

class FakeKV {
  data = new Map();
  async get(key, type) {
    const value = this.data.get(key) ?? null;
    return type === 'json' && value ? JSON.parse(value) : value;
  }
  async put(key, value) { this.data.set(key, value); }
}
const good = {
  sender:'Ada',sender_phone:'09030000000',pickup:'Owerri',
  receiver:'John',receiver_phone:'08010000000',destination:'Port Harcourt',
  items:'Two boxes',service:'Warehousing',notes:'Handle carefully',source:'contact',
};
function context(data = good, env = {}, opts = {}) {
  return {
    request:new Request('https://williamslarrylogistics.com/api/enquiry', {
      method:'POST',headers:{'content-type':opts.contentType || 'application/json',
        origin:opts.origin || 'https://williamslarrylogistics.com',
        'CF-Connecting-IP':opts.ip || '127.0.0.1'},
      body:JSON.stringify(data),
    }),
    env:{ENQUIRY_KV:new FakeKV(),...env},
  };
}
async function payload(response) {return await response.json();}

test('validates form fields and rejects bad phone without sending', async () => {
  const ctx=context({...good, sender_phone:'xyz'});
  const res=await onRequestPost(ctx);
  assert.equal(res.status,422);
  assert.equal((await payload(res)).ok,false);
});
test('rejects cross-origin requests',async()=>{
  const res=await onRequestPost(context(good,{}, {origin:'https://malicious.example'}));
  assert.equal(res.status,403);
});
test('fails closed without KV binding',async()=>{
  const res=await onRequestPost(context(good,{ENQUIRY_KV:null}));
  assert.equal(res.status,503);
});
test('fails closed when neither sender service is configured',async()=>{
  const res=await onRequestPost(context());
  assert.equal(res.status,503);
});
test('delivers via email, deduplicates and retains reference',async()=>{
  const ctx=context(good, {
    RESEND_API_KEY:'test',EMAIL_TO:'info@williamslarrylogistics.com',
    EMAIL_FROM:'WilliamsLarry <enquiries@notify.williamslarrylogistics.com>',
  });
  const realFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async (url,opts)=>{
    calls++;
    assert.equal(url,'https://api.resend.com/emails');
    const data=JSON.parse(opts.body);
    assert.match(data.text,/Owerri/);
    assert.equal(data.to[0],'info@williamslarrylogistics.com');
    return new Response(JSON.stringify({id:'em_test_123'}), {status:200});
  };
  try {
    const result=await onRequestPost(ctx);
    assert.equal(result.status,200);
    const p=await payload(result);
    assert.equal(p.ok,true);
    assert.equal(p.channels.email,'accepted');
    assert.equal(p.channels.whatsapp,'not_configured');
    const again=await onRequestPost(context(good, ctx.env));
    assert.equal(again.status,200);
    assert.equal((await payload(again)).reference,p.reference);
    assert.equal(calls,1);
  } finally {globalThis.fetch=realFetch;}
});
test('delivers WhatsApp alert to boss recipient',async()=>{
  const realFetch=globalThis.fetch;
  const ctx=context(good,{WHATSAPP_ACCESS_TOKEN:'test-token',WHATSAPP_PHONE_NUMBER_ID:'12345678901'});
  globalThis.fetch=async (url,opts)=>{
    assert.equal(url,'https://graph.facebook.com/v27.0/12345678901/messages');
    const data=JSON.parse(opts.body);
    assert.equal(data.to,'2349038704667');
    assert.equal(data.template.components[0].parameters.length,8);
    return new Response(JSON.stringify({messages:[{id:'wamid.123'}]}),{status:200});
  };
  try {
    const res=await onRequestPost(ctx);
    assert.equal(res.status,200);
    assert.equal((await payload(res)).channels.whatsapp,'accepted');
  } finally {globalThis.fetch=realFetch;}
});
test('does not report success if provider rejects notification',async()=>{
  const realFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'Rejected'}),{status:403});
  try {
    const res=await onRequestPost(context(good,{RESEND_API_KEY:'test',EMAIL_TO:'info@williamslarrylogistics.com',EMAIL_FROM:'enquiries@notify.williamslarrylogistics.com'}));
    assert.equal(res.status,502);
    assert.equal((await payload(res)).ok,false);
  } finally {globalThis.fetch=realFetch;}
});
test('only POST is accepted',async()=>{
  assert.equal((await onRequest()).status,405);
});
