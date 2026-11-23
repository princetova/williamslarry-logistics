/*
 * WilliamsLarry Logistics — WhatsApp follow-up AFTER the enquiry email is accepted.
 * Browser-global helper intentionally decoupled from the existing enquiry backend.
 * Include before scripts/site.js. Never call on failed submissions.
 */
(function (global) {
  'use strict';

  const BUSINESS_WHATSAPP_DIGITS = '2349038704667'; // Owner: 09038704667, NOT the test customer
  const VALID_REFERENCE = /^WL-[A-F0-9]{10}$/;

  function clean(value, maxLength) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function field(formData, name, maxLength) {
    if (!formData || typeof formData.get !== 'function') return '';
    return clean(formData.get(name), maxLength);
  }

  function buildWhatsAppUrl({ reference, formData, source = 'quote' } = {}) {
    if (!VALID_REFERENCE.test(String(reference || ''))) {
      throw new TypeError('A verified WilliamsLarry enquiry reference is required.');
    }

    const typeLabel = source === 'contact' ? 'contact enquiry' : 'delivery enquiry';
    const sender = field(formData, 'sender', 90);
    const senderPhone = field(formData, 'sender_phone', 24);
    const service = field(formData, 'service', 80);

    // Short summary only: full addresses/receiver information are already in the email.
    // Avoid exposing detailed personal data in the URL and keep it usable on mobile.
    const lines = [
      `Hello WilliamsLarry Logistics, I just submitted a ${typeLabel} on your website.`,
      `Reference: ${reference}`,
      sender ? `Name: ${sender}` : null,
      senderPhone ? `My phone: ${senderPhone}` : null,
      service ? `Service: ${service}` : null,
      'Please confirm receipt and advise on the next steps.'
    ].filter(Boolean);

    return `https://wa.me/${BUSINESS_WHATSAPP_DIGITS}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function cancelPending(result, browserWindow = global) {
    if (!result || typeof result.querySelector !== 'function') return false;
    let cancelled = false;
    if (result.__wllWhatsAppTimer != null && typeof browserWindow.clearTimeout === 'function') {
      browserWindow.clearTimeout(result.__wllWhatsAppTimer);
      result.__wllWhatsAppTimer = null;
      cancelled = true;
    }
    const link = result.querySelector('.wll-wa-followup-link');
    if (link) link.hidden = true;
    return cancelled;
  }

  function onEmailAccepted({ payload, formData, source, result, browserWindow = global } = {}) {
    // Must be invoked by the EXISTING successful POST /api/enquiry path only.
    // Provider accepted email != confirmed inbox delivery; don't claim otherwise.
    if (!payload || payload.ok !== true || payload.channels?.email !== 'accepted' ||
        !VALID_REFERENCE.test(String(payload.reference || ''))) return false;
    if (!result || typeof result.appendChild !== 'function') return false;

    const url = buildWhatsAppUrl({reference: payload.reference, formData, source});
    const doc = result.ownerDocument || browserWindow.document;
    cancelPending(result, browserWindow);
    let link = result.querySelector('.wll-wa-followup-link');
    if (!link) {
      link = doc.createElement('a');
      link.className = 'wll-wa-followup-link';
      link.textContent = 'Continue on WhatsApp';
      link.setAttribute('aria-label', 'Continue your confirmed website enquiry on WhatsApp');
      result.appendChild(link);
    }
    link.href = url;
    link.target = '_self'; // same-tab navigation avoids popup blocking after asynchronous fetch
    link.hidden = false;

    const message = result.querySelector('p');
    if (message) {
      message.textContent = `Enquiry accepted for email delivery. Reference: ${payload.reference}. Opening WhatsApp to continue; please tap Send there.`;
    }

    // A small visible confirmation interval; direct same-tab navigation is not a popup.
    // Clear any previous timer to avoid duplicate redirects on repeated submits.
    result.__wllWhatsAppTimer = browserWindow.setTimeout(function () {
      result.__wllWhatsAppTimer = null;
      if (!link.isConnected) return;
      browserWindow.location.assign(url);
    }, 900);
    return true;
  }

  global.WLLWhatsAppFollowup = Object.freeze({
    buildWhatsAppUrl,
    cancelPending,
    onEmailAccepted,
    businessWhatsAppDigits: BUSINESS_WHATSAPP_DIGITS
  });
})(typeof window !== 'undefined' ? window : globalThis);
