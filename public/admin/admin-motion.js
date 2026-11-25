/* Phase 4C.8: restrained navigation transitions and server-data feedback only.
   No data is stored, interpolated, simulated, or sent by this script. */
'use strict';
(() => {
  const ready = () => {
    const root = document.documentElement;
    const app = document.getElementById('app');
    if (!app) return;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const toggle = document.getElementById('motion-toggle');
    let transitionsEnabled = !preference.matches;

    const applyMotionPreference = () => {
      const active = transitionsEnabled && !preference.matches;
      root.classList.toggle('motion-off', !active);
      if (!toggle) return;
      toggle.setAttribute('aria-pressed', String(active));
      toggle.setAttribute('aria-label', 'Toggle short view transitions');
      toggle.title = active ? 'Turn off short view transitions' : 'Turn on short view transitions';
      const label = toggle.querySelector('.motion-label');
      if (label) label.textContent = active ? 'Transitions on' : 'Transitions off';
    };

    applyMotionPreference();
    toggle?.addEventListener('click', () => {
      transitionsEnabled = !transitionsEnabled;
      applyMotionPreference();
    });
    preference.addEventListener?.('change', event => {
      if (event.matches) transitionsEnabled = false;
      applyMotionPreference();
    });

    const sidebar = document.getElementById('sidebar');
    const openNav = document.getElementById('open-nav');
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && sidebar?.classList.contains('is-open')) {
        requestAnimationFrame(() => openNav?.focus());
      }
    }, {capture: true});

    // Preserve the server-data indicator while leaving source text untouched.
    const counterIds = [
      'stat-total', 'stat-active', 'stat-delivered', 'stat-unassigned',
      'stat-pending', 'stat-issues', 'stat-week'
    ];
    const topActions = app.querySelector('.top-actions');
    let syncLabel = null;
    if (topActions && !topActions.querySelector('.liquid-sync')) {
      const chip = document.createElement('span');
      chip.className = 'liquid-sync';
      chip.hidden = true;
      const dot = document.createElement('span');
      dot.className = 'liquid-sync-dot';
      dot.setAttribute('aria-hidden', 'true');
      syncLabel = document.createElement('span');
      syncLabel.className = 'liquid-sync-label';
      syncLabel.textContent = 'Data loaded';
      chip.append(dot, syncLabel);
      const anchor = topActions.querySelector('.motion-toggle');
      if (anchor) anchor.after(chip);
      else topActions.prepend(chip);
    }

    const markDataLoaded = node => {
      if (!node || !/^\d[\d,]*$/.test(node.textContent.trim())) return;
      const chip = app.querySelector('.liquid-sync');
      if (!chip) return;
      if (!syncLabel) syncLabel = chip.querySelector('.liquid-sync-label');
      chip.hidden = false;
      if (syncLabel) syncLabel.textContent = 'Data received';
      chip.title = 'Statistics received from the server';
    };

    for (const id of counterIds) {
      const node = document.getElementById(id);
      if (!node) continue;
      const observer = new MutationObserver(() => markDataLoaded(node));
      observer.observe(node, {childList: true, characterData: true, subtree: true});
      markDataLoaded(node);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, {once: true});
  } else {
    ready();
  }
})();
