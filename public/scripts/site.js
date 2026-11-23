/*
 * WilliamsLarry Logistics — shared website interactions.
 * Features: mobile navigation, quote dialog, contact submission, reveal motion.
 * API endpoint: /api/enquiry (Cloudflare Pages Function).
 * All behavior preserved from V2.4.
 */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const menu = $('#main-nav');
  const menuButton = $('#menu-toggle');
  const dialog = $('#quote-dialog');
  const quoteForm = $('#quote-form');

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
  const dateInput = $('#delivery-date');
  if (dateInput) {
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    dateInput.min = localToday;
  }
  function closeMenu() {
    menu.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
  }
  menuButton.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  $$('.main-nav a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('click', event => {
    if (menu.classList.contains('open') && !event.target.closest('.site-header')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });

  function openQuote() {
    closeMenu();
    $('#quote-result').hidden = true;
    if (!dialog.open) dialog.showModal();
  }
  $$('[data-open-quote]').forEach(button => button.addEventListener('click', () => {
    const service = button.dataset.service;
    if (service && quoteForm.elements.service) quoteForm.elements.service.value = service;
    openQuote();
  }));
  $('#quote-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  function formattedEnquiry(data) {
    const value = key => String(data.get(key) || '').trim();
    return `WILLIAMSLARRY LOGISTICS — DELIVERY ENQUIRY\n\n` +
      `SENDER\nName: ${value('sender')}\nPhone: ${value('sender_phone')}\nPickup address: ${value('pickup')}\n\n` +
      `RECEIVER\nName: ${value('receiver')}\nPhone: ${value('receiver_phone')}\nDrop-off address: ${value('destination')}\n\n` +
      `ITEM(S)\n${value('items')}` +
      (value('service') ? `\n\nSERVICE REQUESTED\n${value('service')}` : '') +
      (value('notes') ? `\n\nSPECIAL INSTRUCTIONS\n${value('notes')}` : '') +
      `\n\nPlease confirm service availability, delivery arrangements and pricing.`;
  }
  // Submit through our serverless Pages Function. Provider API keys stay on the server.
  // The copy-details UI remains a fallback when messaging is unavailable.
  async function sendEnquiry(form, source, resultSelector, textSelector) {
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const preparedText = formattedEnquiry(data);
    const result = $(resultSelector);
    const preview = $(textSelector);
    const copyButton = result.querySelector('button[type="button"]');
    const message = result.querySelector('p');
    const submitButton = form.querySelector('[type="submit"]');
    if (!result || !preview || !copyButton || !message || !submitButton) return;
    // Cancel a previous success timer before any new request. A rapid failed
    // resubmission must never be followed by an earlier WhatsApp redirect.
    try {
      window.WLLWhatsAppFollowup?.cancelPending?.(result);
    } catch {
      console.warn('Optional WhatsApp follow-up reset unavailable');
    }
    const initialHtml = submitButton.innerHTML;
    result.hidden = false;
    preview.textContent = preparedText;
    preview.hidden = true;
    copyButton.hidden = true;
    message.classList.remove('result-error');
    message.classList.add('result-success');
    message.textContent = 'Sending your enquiry securely…';
    submitButton.disabled = true;
    submitButton.textContent = 'SENDING ENQUIRY…';
    submitButton.setAttribute('aria-busy', 'true');
    try {
      // A file:// preview cannot run Pages Functions; tell the visitor the truth and keep a copy option.
      if (window.location.protocol === 'file:') {
        throw new Error('Automatic notifications require a deployed website with the Cloudflare API configured. Copy the details below for now.');
      }
      const body = Object.fromEntries(data.entries());
      body.source = source;
      const response = await fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error(payload?.message || 'Your enquiry could not be submitted. Please try again or contact us on WhatsApp.');
      }
      // Email is the authoritative notification channel. The retired paid
      // WhatsApp provider must never turn an email failure into false success.
      if (typeof payload.reference !== 'string' || !/^WL-[A-F0-9]{10}$/.test(payload.reference) ||
          payload.channels?.email !== 'accepted') {
        throw new Error('Notification delivery could not be confirmed. Please contact us directly or copy your enquiry details.');
      }
      message.textContent = `${payload.message || 'Your enquiry was accepted for notification delivery.'} Reference: ${payload.reference}`;
      if (payload.channels?.email === 'accepted') {
        try {
          window.WLLWhatsAppFollowup?.onEmailAccepted({payload, formData: data, source, result});
        } catch {
          // Email acceptance is already confirmed. Keep the enquiry successful
          // even if the optional customer-side WhatsApp handoff is unavailable.
          console.warn('Optional WhatsApp follow-up unavailable');
        }
      }
    } catch (error) {
      message.classList.remove('result-success');
      message.classList.add('result-error');
      message.textContent = error instanceof Error ? error.message : 'The enquiry could not be sent.';
      preview.hidden = false;
      copyButton.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.innerHTML = initialHtml;
      result.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    }
  }

  quoteForm.addEventListener('submit', event => {
    event.preventDefault();
    sendEnquiry(quoteForm, 'quote', '#quote-result', '#quote-text');
  });

  async function copyText(text, button, defaultText) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const temporary = document.createElement('textarea');
        temporary.value = text;
        temporary.style.position = 'fixed';
        temporary.style.opacity = '0';
        document.body.appendChild(temporary);
        temporary.select();
        const didCopy = document.execCommand('copy');
        temporary.remove();
        if (!didCopy) throw new Error('Copy not supported');
      }
      button.textContent = '✓ COPIED TO CLIPBOARD';
      setTimeout(() => { button.textContent = defaultText; }, 2200);
    } catch {
      button.textContent = 'SELECT THE TEXT ABOVE TO COPY';
    }
  }
  const copyQuote = $('#copy-quote');
  copyQuote.addEventListener('click', () => copyText($('#quote-text').textContent, copyQuote, 'COPY DETAILS'));

  const contactForm = $('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', event => {
      event.preventDefault();
      sendEnquiry(contactForm, 'contact', '#contact-result', '#contact-text');
    });
    const copyContact = $('#copy-contact');
    copyContact.addEventListener('click', () => copyText($('#contact-text').textContent, copyContact, 'COPY MESSAGE'));
  }

  const trackingForm = $('#tracking-form');
  if (trackingForm) {
    trackingForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!trackingForm.reportValidity()) return;
      const target = $('#tracking-result');
      target.hidden = false;
      // Intentionally no simulated or invented shipment status.
      target.textContent = 'Live tracking is not available in this prototype. This reference has not been checked against any shipment database. The tracking service will be enabled once WilliamsLarry connects its verified operational records.';
    });
  }

  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {threshold: .085, rootMargin: '0px 0px -16px 0px'});
    reveals.forEach(node => observer.observe(node));
  } else {
    reveals.forEach(node => node.classList.add('is-visible'));
  }
  const progress = $('#progress');
  let ticking = false;
  function updateProgress() {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${total > 0 ? (window.scrollY / total) * 100 : 0}%`;
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
  }, {passive: true});
  updateProgress();

  // Respect reduced-motion preferences and avoid playing background media offscreen.
  const videos = $$('video[autoplay]');
  function updateVideoMotion() {
    videos.forEach(video => {
      if (reducedMotion.matches) video.pause();
      else video.play().catch(() => { /* poster remains visible if autoplay is blocked */ });
    });
  }
  updateVideoMotion();
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', updateVideoMotion);
  if ('IntersectionObserver' in window) {
    const mediaObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      const video = entry.target;
      if (reducedMotion.matches || !entry.isIntersecting) video.pause();
      else video.play().catch(() => {});
    }), {threshold: .07});
    videos.forEach(video => mediaObserver.observe(video));
  }
})();
