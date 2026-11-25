/* Phase 4C.4. Progressive visual enhancement only.
   No fetch, storage, authorization changes, or simulated business results. */
'use strict';
(() => {
  const ready = () => {
    const app = document.getElementById('app');
    if (!app) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    const isMotionOn = () => !reduced.matches && !root.classList.contains('motion-off');

    // A genuinely traveling highlight for the real navigation state.
    const navs = Array.from(app.querySelectorAll('.side-nav')).filter(n => n.querySelector('button[data-view]'));
    const positionNav = (instant = false) => {
      for (const nav of navs) {
        const glider = nav.querySelector('.nav-glider');
        const active = nav.querySelector('button.side-link.active:not([hidden])');
        if (!glider) continue;
        glider.style.transitionDuration = instant || !isMotionOn() ? '0s' : '';
        if (!active) { glider.style.setProperty('--glider-opacity','0'); continue; }
        glider.style.setProperty('--glider-opacity','1');
        glider.style.setProperty('--glider-y',`${active.offsetTop}px`);
        glider.style.height = `${active.offsetHeight}px`;
      }
    };
    for (const nav of navs) {
      const glider = document.createElement('span');
      glider.className = 'nav-glider';
      glider.setAttribute('aria-hidden','true');
      nav.prepend(glider);
      const observer = new MutationObserver(() => requestAnimationFrame(() => positionNav()));
      for (const link of nav.querySelectorAll('button[data-view]')) {
        observer.observe(link,{attributes:true,attributeFilter:['class','hidden']});
      }
    }
    const resizer = new ResizeObserver(() => positionNav(true));
    for (const nav of navs) resizer.observe(nav);
    document.fonts?.ready?.then(() => positionNav(true)).catch(() => {});
    requestAnimationFrame(() => positionNav(true));

    // Live status composition. Reads ONLY statuses already supplied by admin.js.
    // Never creates values, locations, shipments or forecasts.
    const distribution = document.getElementById('distribution');
    const composition = document.getElementById('status-composition');
    const colors = ['#007BFF','#74B9FF','#005EC7','#A4C9F0','#375B80','#C6A900','#D17A36','#64748B','#B4C2D1'];
    if(distribution && composition) {
      const draw = () => {
        const rows = Array.from(distribution.querySelectorAll('.bar-row'));
        if (!rows.length) {
          composition.replaceChildren();
          const placeholder = document.createElement('span');
          placeholder.className = 'composition-pending';
          placeholder.textContent = distribution.querySelector('.empty-state') ? 'Statistics unavailable' : 'Waiting for shipment statistics';
          composition.append(placeholder);
          composition.setAttribute('aria-label', placeholder.textContent);
          return;
        }
        const records = rows.map((row,i) => ({name:row.querySelector('span')?.textContent?.trim()||'Status', amount:Number((row.querySelector('strong')?.textContent||'0').replace(/,/g,''))||0, color:colors[i%colors.length]}));
        const total = records.reduce((sum,x) => sum+x.amount,0);
        composition.replaceChildren();
        if (total <= 0) {
          const empty = document.createElement('span');empty.className='composition-pending';empty.textContent='No shipments registered yet';composition.append(empty);
          composition.setAttribute('aria-label','No shipments registered yet');
          return;
        }
        const description = [];
        records.forEach((record,i) => {
          if (!record.amount) return;
          description.push(`${record.name}: ${record.amount}`);
          const segment=document.createElement('button');segment.type='button';segment.className='composition-segment';
          segment.style.flexGrow=String(record.amount);segment.style.flexBasis='0';segment.style.background=record.color;
          segment.style.setProperty('--segment',String(i));
          segment.title=`${record.name}: ${record.amount} shipments. View matching shipments`;
          segment.setAttribute('aria-label',segment.title);
          segment.addEventListener('click',() => {
            const select = document.getElementById('filter-status');
            const form = document.getElementById('search-form');
            if (!select || !form) return;
            select.value = record.name;
            form.requestSubmit();
          });
          composition.append(segment);
        });
        composition.setAttribute('aria-label',`Shipment distribution — ${description.join('; ')}`);
      };
      new MutationObserver(draw).observe(distribution,{childList:true,subtree:true});
      draw();
    }

    // Delivery share is an accurately labelled ratio of the two real server counters.
    const totalEl=document.getElementById('stat-total');
    const deliveredEl=document.getElementById('stat-delivered');
    const ring=document.getElementById('hero-delivery-ring');
    const percentEl=document.getElementById('hero-delivery-percent');
    const fractionEl=document.getElementById('hero-delivery-fraction');
    if(totalEl && deliveredEl && ring && percentEl && fractionEl) {
      let updateTimer=0;
      const refresh = () => {
        const t=totalEl.textContent.trim().replace(/,/g,'');
        const d=deliveredEl.textContent.trim().replace(/,/g,'');
        if(!/^\d+$/.test(t)||!/^\d+$/.test(d)) {
          percentEl.textContent='—';fractionEl.textContent='— / —';ring.style.setProperty('--completion','0');return;
        }
        const total=Number(t), delivered=Number(d);
        if(!Number.isSafeInteger(total)||!Number.isSafeInteger(delivered))return;
        const percent=total===0?0:Math.min(100,Math.round(100*delivered/total));
        percentEl.textContent=percent+'%';
        fractionEl.textContent=delivered.toLocaleString('en-NG')+' / '+total.toLocaleString('en-NG');
        ring.style.setProperty('--completion',String(percent));
        ring.setAttribute('aria-label',`${percent}% of ${total} registered shipments have been delivered`);
      };
      const changed=() => {
        if(!/^\d/.test(totalEl.textContent)||!/^\d/.test(deliveredEl.textContent)) {clearTimeout(updateTimer);refresh();return;}
        clearTimeout(updateTimer);updateTimer=setTimeout(refresh,110);
      };
      new MutationObserver(changed).observe(totalEl,{childList:true,characterData:true,subtree:true});
      new MutationObserver(changed).observe(deliveredEl,{childList:true,characterData:true,subtree:true});
      refresh();
    }
    // The experience uses no pointer-following reflections or visual-only effects.
    const motionToggle=document.getElementById('motion-toggle');
    motionToggle?.addEventListener('click',() => requestAnimationFrame(() => positionNav(true)));
    reduced.addEventListener?.('change',() => positionNav(true));
    window.addEventListener('resize',() => positionNav(true),{passive:true});
    // Never persist display preferences or client information.
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
