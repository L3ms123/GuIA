// Tutorial

function initTutorial() {
  const openBtn = el('tutorial-open-btn');
  const closeBtn = el('tutorial-close-btn');
  const prevBtn = el('tutorial-prev-btn');
  const nextBtn = el('tutorial-next-btn');
  const doneBtn = el('tutorial-done-btn');
  const modal = el('tutorial-modal');

  if (!openBtn || !modal) return;

  let lastFocus = null;
  let currentStep = 0;
  let advancingFromAction = false;
  let waitingForAction = false;

  function sendStepIndex() {
    return tutorialItems().findIndex((item) => item.waitForSend || item.target === '#send-btn');
  }

  function questionStepIndex() {
    return tutorialItems().findIndex((item) => item.waitForQuestion);
  }

  function questionIsReady() {
    return !!el('chat-input')?.value.trim();
  }

  function goToSendStep() {
    const index = sendStepIndex();
    if (index >= 0) goToStep(index);
    else goNext();
  }

  function isQrStep() {
    const item = tutorialItems()[currentStep] || {};
    return item.qrAction || item.target === '#scan-qr-btn';
  }

  function tutorialItems() {
    const items = t('tutorial.steps', []);
    return Array.isArray(items) ? items : [];
  }

  function focusableTutorialNodes() {
    return qa(
      'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      modal
    ).filter((node) => node.offsetParent !== null);
  }

  function clearTutorialTarget() {
    qa('.tutorial-target').forEach((node) => node.classList.remove('tutorial-target'));
  }

  function targetForStep(item) {
    const selectors = Array.isArray(item.targets) ? item.targets : [item.target];
    for (const selector of selectors) {
      if (!selector) continue;
      const target = q(selector);
      if (target && target.offsetParent !== null) return target;
    }
    return null;
  }

  function showAudioPanelIfNeeded(item) {
    if (item.openPanel !== 'audio') return;
    const btn = el('audio-settings-btn');
    if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
  }

  function closeAudioPanelIfOpen() {
    document.body.removeAttribute('data-audio-settings-open');

    const audioBtn = el('audio-settings-btn');
    if (audioBtn) {
      audioBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function showLocationPanelIfNeeded(item) {
    if (item.openPanel !== 'location' && item.openPanel !== 'manualLocation') return;
    const btn = el('location-panel-btn');
    if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();

    if (item.openPanel === 'manualLocation') {
      const manualBtn = el('manual-location-btn');
      const manualPanel = el('manual-location-panel');
      if (manualBtn && manualPanel?.hasAttribute('hidden')) manualBtn.click();
    }
  }

  function firstStepAfterLocationGroup() {
    const items = tutorialItems();
    const nextIndex = items.findIndex((item) => item.group !== 'location');
    return nextIndex < 0 ? currentStep + 1 : nextIndex;
  }

  function firstUsableTarget(target) {
    if (!target) return null;
    if (target.matches?.('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
      return target;
    }
    return q('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', target);
  }

  function startActionMode() {
    const item = tutorialItems()[currentStep] || {};
    waitingForAction = true;
    modal.setAttribute('data-waiting-action', 'true');
    highlightStepTarget(item);

    window.setTimeout(() => {
      firstUsableTarget(targetForStep(item))?.focus?.();
    }, 120);
  }

  function endActionMode() {
    waitingForAction = false;
    modal.removeAttribute('data-waiting-action');
  }

  function highlightStepTarget(item) {
    clearTutorialTarget();
    showAudioPanelIfNeeded(item);
    showLocationPanelIfNeeded(item);

    window.setTimeout(() => {
      const target = targetForStep(item);
      if (!target) return;
      target.classList.add('tutorial-target');
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 80);
  }

  function goToStep(step) {
    const total = tutorialItems().length;
    endActionMode();
    currentStep = Math.max(0, Math.min(step, Math.max(total - 1, 0)));
    renderCurrentStep();
  }

  function goNext() {
    const total = tutorialItems().length;
    if (!total || currentStep >= total - 1) return;
    goToStep(currentStep + 1);
  }

  function currentStepMatches(selectors, eventTarget) {
    const item = tutorialItems()[currentStep] || {};
    const stepSelectors = Array.isArray(item.targets) ? item.targets : [item.target];
    return selectors.some((selector) => {
      if (!stepSelectors.includes(selector)) return false;
      return !!eventTarget?.closest?.(selector);
    });
  }

  function advanceFromAction() {
    if (advancingFromAction) return;
    advancingFromAction = true;
    window.setTimeout(() => {
      endActionMode();
      goNext();
      advancingFromAction = false;
    }, 250);
  }

  function bindTutorialActionAdvance() {
    document.addEventListener('click', (event) => {
      if (!document.body.hasAttribute('data-tutorial-open')) return;
      if (event.target.closest?.('#tutorial-modal')) return;

      const item = tutorialItems()[currentStep] || {};

      // Pas QR: obre l'escàner i amaga l'ajuda, però NO avança al pas 4
      if (isQrStep() && event.target.closest?.('#scan-qr-btn')) {
        startActionMode();
        return;
      }

      // Si tanques l'escàner QR, llavors sí que continua
      if (isQrStep() && event.target.closest?.('#close-qr-btn')) {
        endActionMode();
        goNext();
        return;
      }

      // Confirmar ubicació manual
      if (event.target.closest?.('#set-context-btn')) {
        const roomSelect = el('room-select');

        if (item.requireLocation && roomSelect?.value) {
          endActionMode();
          goToStep(firstStepAfterLocationGroup());
        }

        return;
      }

      // Pas del micròfon: espera que el micro acabi posant text a l'input
      if (item.waitForVoice && event.target.closest?.('#mic-btn')) {
        startActionMode();
        return;
      }

      // Pas d'enviar: només permet avançar si ja hi ha una pregunta
      if (item.waitForSend && event.target.closest?.('#send-btn')) {
        if (!questionIsReady()) {
          const qIndex = questionStepIndex();
          if (qIndex >= 0) goToStep(qIndex);
          el('chat-input')?.focus();
          return;
        }

        advanceFromAction();
        return;
      }

      // Resta de passos interactius normals
      if (currentStepMatches([
        '#location-panel-btn',
        '#open-app-btn',
        '#manual-location-btn',
        '#chat-thread',
        '.chat-panel',
        '#audio-settings-btn',
        '#audio-controls-panel',
        '#app-title'
      ], event.target)) {
        if (currentStep >= tutorialItems().length - 1) {
          window.setTimeout(closeTutorial, 250);
          return;
        }

        advanceFromAction();
      }
    }, true);

    document.addEventListener('guia:location-selected', () => {
      if (!document.body.hasAttribute('data-tutorial-open')) return;

      const item = tutorialItems()[currentStep] || {};

      if (item.group === 'location' || item.requireLocation || item.qrAction) {
        endActionMode();
        goToStep(firstStepAfterLocationGroup());
      }
    });

    el('chat-input')?.addEventListener('input', (event) => {
      if (!document.body.hasAttribute('data-tutorial-open')) return;

      const item = tutorialItems()[currentStep] || {};
      if (!item.waitForQuestion && !item.waitForVoice) return;

      if (event.target.value.trim()) {
        endActionMode();
        goToSendStep();
      }
    });
  }

  function renderCurrentStep() {
    const stepsNode = el('tutorial-steps');
    if (!stepsNode) return;

    const items = tutorialItems();
    const item = items[currentStep] || {};
    const isMobile = window.matchMedia('(max-width: 880px)').matches;
    const target = item.target || '';

    const shouldPlaceTop =
      target === '.input-shell' ||
      target === '#mic-btn' ||
      target === '#send-btn' ||
      item.waitForQuestion ||
      item.waitForVoice ||
      item.waitForSend;

    if (shouldPlaceTop) {
      modal.setAttribute('data-placement', 'top');
    } else if (item.requireLocation) {
      modal.setAttribute('data-placement', isMobile ? 'top' : 'left');
    } else if (currentStep >= 5) {
      modal.setAttribute('data-placement', 'right');
    } else {
      modal.removeAttribute('data-placement');
    }
    const total = Math.max(items.length, 1);

    setText(el('tutorial-open-text'), t('tutorial.open', 'Help'));
    setAttribute(el('tutorial-open-btn'), 'aria-label', t('tutorial.openLabel', 'Help: how to use GuIA'));
    setAttribute(el('tutorial-open-btn'), 'title', t('tutorial.openLabel', 'Help: how to use GuIA'));
    setText(el('tutorial-kicker'), t('tutorial.kicker', 'Help'));
    setText(el('tutorial-title'), t('tutorial.title', 'How to use GuIA'));
    setText(el('tutorial-intro'), t('tutorial.intro', 'One step at a time.'));
    setText(el('tutorial-prev-btn'), t('tutorial.previous', 'Back'));
    setText(el('tutorial-next-btn'), t('tutorial.next', 'Next'));
    setText(el('tutorial-done-btn'), t('tutorial.done', 'Got it'));
    setAttribute(el('tutorial-close-btn'), 'aria-label', t('tutorial.close', 'Close help'));

    stepsNode.textContent = '';

    const card = document.createElement('article');
    card.className = 'tutorial-step';
    card.setAttribute('aria-live', 'polite');

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined tutorial-step-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.icon || 'info';

    const content = document.createElement('div');
    content.className = 'tutorial-step-content';

    const progress = document.createElement('p');
    progress.className = 'tutorial-progress';
    progress.textContent = t('tutorial.progress', 'Step {current} of {total}')
      .replace('{current}', currentStep + 1)
      .replace('{total}', total);

    const title = document.createElement('h3');
    title.textContent = item.title || '';

    const body = document.createElement('p');
    body.textContent = item.body || '';

    content.append(progress, title, body);
    card.append(icon, content);
    stepsNode.appendChild(card);

    if (prevBtn) prevBtn.disabled = currentStep === 0;
    if (nextBtn) {
      nextBtn.hidden = currentStep >= total - 1;
      nextBtn.disabled = false;
    }
    if (doneBtn) doneBtn.hidden = currentStep < total - 1;

    highlightStepTarget(item);
    window.setTimeout(() => {
      const selector = item.target || (Array.isArray(item.targets) ? item.targets[0] : item.targets);
      const target = selector ? document.querySelector(selector) : null;

      if (!target) return;

      target.scrollIntoView({
        behavior: 'smooth',
        block: window.matchMedia('(max-width: 880px)').matches ? 'center' : 'nearest',
        inline: 'nearest'
      });
    }, 120);
  }

  function openTutorial() {
    lastFocus = document.activeElement;
    currentStep = 0;

    clearTutorialTarget();
    modal.removeAttribute('data-placement');
    modal.removeAttribute('data-waiting-action');

    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.setAttribute('data-tutorial-open', '');

    renderCurrentStep();
  }

  function closeTutorial() {
    clearTutorialTarget();
    endActionMode();
    closeAudioPanelIfOpen();

    modal.removeAttribute('data-placement');
    modal.removeAttribute('data-waiting-action');

    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('hidden', '');
    modal.hidden = true;
    document.body.removeAttribute('data-tutorial-open');

    const playbackBtn = el('audio-playback-btn');
    if (playbackBtn && playbackBtn.getAttribute('aria-pressed') === 'true') {
      playbackBtn.click();
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

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextBtn?.click();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prevBtn?.click();
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
  prevBtn?.addEventListener('click', () => {
    if (currentStep <= 0) return;
    goToStep(currentStep - 1);
  });
  nextBtn?.addEventListener('click', () => {
    const item = tutorialItems()[currentStep] || {};

    if (item.waitForAction || item.requireLocation) {
      startActionMode();
      return;
    }

    if (item.openPanel === 'audio' || item.target === '#audio-controls-panel') {
      closeAudioPanelIfOpen();
    }

    goNext();
  });
  bindTutorialActionAdvance();

  window.guiaOpenTutorial = openTutorial;
  window.guiaApplyTutorialTranslations = renderCurrentStep;
  renderCurrentStep();
}

function renderTutorial() {
  window.guiaApplyTutorialTranslations?.();
}
