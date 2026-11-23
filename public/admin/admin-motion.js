/* WilliamsLarry Phase 4C.3 — purely presentational enhancements.
   Uses no storage, network requests, or privileged API endpoints.
   It must not influence role permissions or the underlying shipment state. */
'use strict';
(() => {
  const ready = () => {
    const root = document.documentElement;
    const app = document.getElementById('app');
    if (!app) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionToggle = document.getElementById('motion-toggle');
    let enabled = !reduced.matches;
    const applyMotion = () => {
      root.classList.toggle('motion-off', !enabled);
      if (motionToggle) {
        motionToggle.setAttribute('aria-pressed', String(enabled));
        const label = motionToggle.querySelector('.motion-label');
        if (label) label.textContent = enabled ? 'Motion on' : 'Motion off';
      }
    };
    applyMotion();
    motionToggle?.addEventListener('click', () => {enabled = !enabled;applyMotion();});
    reduced.addEventListener?.('change', event => {if (event.matches) {enabled=false;applyMotion();}});

    // No sensitive records are stored or printed. Optically refract only the hovered card.
    let active = null;
    let frame = 0;
    app.addEventListener('pointermove', e => {
      if (!enabled || e.pointerType === 'touch') return;
      const target = e.target instanceof Element ? e.target.closest('.glass-panel,.stat-card,.mini-stat') : null;
      if (target === active && target === null) return;
      active = target;
      if (!target) return;
      cancelAnimationFrame(frame);
      const clientX=e.clientX,clientY=e.clientY;
      frame=requestAnimationFrame(() => {
        if(!target.isConnected)return;
        const rect=target.getBoundingClientRect();
        target.style.setProperty('--pointer-x', `${((clientX-rect.left)/rect.width*100).toFixed(1)}%`);
        target.style.setProperty('--pointer-y', `${((clientY-rect.top)/rect.height*100).toFixed(1)}%`);
      });
    }, {passive:true});
    app.addEventListener('pointerout', e => {
      const from=e.target instanceof Element?e.target.closest('.glass-panel,.stat-card,.mini-stat'):null;
      if(from && !from.contains(e.relatedTarget)){
        from.style.removeProperty('--pointer-x');from.style.removeProperty('--pointer-y');
      }
    }, {passive:true});

    // Button ripples and moving focus feedback. Does not simulate requests or mutate records.
    document.addEventListener('click', e => {
      if (!enabled || reduced.matches) return;
      if (!(e.target instanceof Element)) return;
      const button=e.target.closest('.action,.icon-button,.side-link,.motion-toggle');
      if(!button || button.disabled || !(button instanceof HTMLElement))return;
      const rect=button.getBoundingClientRect();
      const circle=document.createElement('span');circle.className='wll-ripple';
      circle.style.left=`${e.clientX-rect.left}px`;circle.style.top=`${e.clientY-rect.top}px`;
      button.append(circle);
      circle.addEventListener('animationend',()=>circle.remove(),{once:true});
      setTimeout(()=>circle.remove(),800);
    });

    // Real values loaded by admin.js count up once. No fake statistics or background data polling.
    const counters=['stat-total','stat-active','stat-delivered','stat-unassigned','stat-pending','stat-issues','stat-week'];
    let syncLabel;
    const topActions=app.querySelector('.top-actions');
    if(topActions){
      const chip=document.createElement('span');chip.className='liquid-sync';chip.hidden=true;
      const dot=document.createElement('span');dot.className='liquid-sync-dot';dot.setAttribute('aria-hidden','true');
      syncLabel=document.createElement('span');syncLabel.className='liquid-sync-label';syncLabel.textContent='Data loaded';
      chip.append(dot,syncLabel);
      const anchor=topActions.querySelector('.motion-toggle');
      if(anchor)anchor.after(chip);else topActions.prepend(chip);
    }
    const lastValues=new WeakMap();
    for(const id of counters){
      const node=document.getElementById(id);if(!node)continue;
      let animationFrame=0,painting=false;
      const onChange = () => {
        if (painting) return;
        const display=node.textContent.trim().replace(/,/g,'');
        if(!/^\d+$/.test(display))return;
        const target=Number(display);
        if (!Number.isFinite(target))return;
        const previous=lastValues.get(node);
        if (previous===target)return;
        lastValues.set(node,target);
        const sync=app.querySelector('.liquid-sync');
        if(sync){sync.hidden=false;syncLabel.textContent='Data refreshed';sync.title='Most recent statistics received from the server';}
        if(!enabled || reduced.matches || target>100000000)return;
        cancelAnimationFrame(animationFrame);
        const start=typeof previous==='number'?previous:0;
        if(start===target)return;
        const begin=performance.now(),duration=650;
        painting=true;
        const step=now=>{
          if(!node.isConnected){painting=false;return;}
          const t=Math.min((now-begin)/duration,1);
          const eased=1-Math.pow(1-t,4);
          node.textContent=Math.round(start+(target-start)*eased).toLocaleString('en-NG');
          if(t<1 && enabled && !reduced.matches)animationFrame=requestAnimationFrame(step);
          else{node.textContent=target.toLocaleString('en-NG');painting=false;}
        };
        animationFrame=requestAnimationFrame(step);
      };
      new MutationObserver(onChange).observe(node,{childList:true,characterData:true,subtree:true});
      onChange();
    }

    // Stagger rows only after DOM API data has been rendered, preserving actual ordering.
    let pending=false;
    const decorate=()=>{
      pending=false;
      app.querySelectorAll('.stats-grid .stat-card').forEach((el,i)=>el.style.setProperty('--stagger',String(i)));
      app.querySelectorAll('.mini-stat-grid .mini-stat').forEach((el,i)=>el.style.setProperty('--stagger',String(i)));
      for (const list of app.querySelectorAll('.table-host tbody,.attention-list,.worker-list,.list-cards,.issue-list,.workload-list')){
        Array.from(list.children).slice(0,16).forEach((el,i)=>{if(!el.style.getPropertyValue('--list-stagger'))el.style.setProperty('--list-stagger',String(Math.min(i,7)));});
      }
    };
    const scheduleDecorate=()=>{if(!pending){pending=true;requestAnimationFrame(decorate);}};
    new MutationObserver(records => {
      if (records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1))) scheduleDecorate();
    }).observe(app,{childList:true,subtree:true});
    scheduleDecorate();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
})();
