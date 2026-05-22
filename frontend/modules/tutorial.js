// Tutorial

function initTutorial() {
  const openBtn = el('tutorial-open-btn');
  const closeBtn = el('tutorial-close-btn');
  const doneBtn = el('tutorial-done-btn');
  const modal = el('tutorial-modal');
  const appShell = q('.app-shell');

  if (!openBtn || !modal) return;

  let lastFocus = null;

  function focusableTutorialNodes() {
    return qa(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      modal
    ).filter((node) => node.offsetParent !== null);
  }

  function openTutorial() {
    lastFocus = document.activeElement;
    renderTutorial();
    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.removeAttribute('aria-hidden');
    appShell?.setAttribute('inert', '');
    document.body.toggleAttribute('data-tutorial-open', true);
    
    // Pause audio when tutorial opens
    const playbackBtn = el('audio-playback-btn');
    if (playbackBtn && playbackBtn.getAttribute('aria-pressed') === 'false') {
      playbackBtn.click();
    }
    
    window.setTimeout(() => {
      const focusables = focusableTutorialNodes();
      (focusables[0] || modal).focus?.();
    }, 0);
  }

  function closeTutorial() {
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('hidden', '');
    modal.hidden = true;
    document.body.removeAttribute('data-tutorial-open');
    
    // Resume audio when tutorial closes
    const playbackBtn = el('audio-playback-btn');
    if (playbackBtn && playbackBtn.getAttribute('aria-pressed') === 'true') {
      playbackBtn.click();
    }

    if (!document.body.hasAttribute('data-onboarding-open')) {
      appShell?.removeAttribute('inert');
    }

    requestAnimationFrame(() => lastFocus?.focus?.());

    window.setTimeout(() => {
      if (!document.body.hasAttribute('data-onboarding-open')) {
        window.guiaSpeakInitialWelcome?.();
      }
    }, 0);
  }

  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTutorial();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = focusableTutorialNodes();
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  openBtn.addEventListener('click', openTutorial);
  closeBtn?.addEventListener('click', closeTutorial);
  doneBtn?.addEventListener('click', closeTutorial);

  window.guiaOpenTutorial = openTutorial;
  window.guiaApplyTutorialTranslations = renderTutorial;
  renderTutorial();
}

function renderTutorial() {
  const steps = el('tutorial-steps');
  if (!steps) return;

  setText(el('tutorial-open-text'), t('tutorial.open', 'Help'));
  setAttribute(el('tutorial-open-btn'), 'aria-label', t('tutorial.openLabel', 'Help: how to use GuIA'));
  setAttribute(el('tutorial-open-btn'), 'title', t('tutorial.openLabel', 'Help: how to use GuIA'));
  setText(el('tutorial-kicker'), t('tutorial.kicker', 'Help'));
  setText(el('tutorial-title'), t('tutorial.title', 'How to use GuIA'));
  setText(el('tutorial-intro'), t('tutorial.intro', 'This guide explains the main buttons. You can read it and close it whenever you want.'));
  setText(el('tutorial-done-btn'), t('tutorial.done', 'Got it'));
  setAttribute(el('tutorial-close-btn'), 'aria-label', t('tutorial.close', 'Close help'));

  const items = t('tutorial.steps', []);
  steps.textContent = '';

  if (!Array.isArray(items)) return;

  const visibleItems = items;

  visibleItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'tutorial-step';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined tutorial-step-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.icon || 'info';

    const content = document.createElement('div');
    content.className = 'tutorial-step-content';

    const title = document.createElement('h3');
    title.textContent = `${index + 1}. ${(item.title || '').replace(/^\d+\.\s*/, '')}`;

    const body = document.createElement('p');
    body.textContent = item.body || '';

    content.append(title, body);
    li.append(icon, content);
    steps.appendChild(li);
  });
}
