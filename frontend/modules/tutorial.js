// Tutorial

function initTutorial() {
  const openBtn = el('tutorial-open-btn');
  const closeBtn = el('tutorial-close-btn');
  const prevBtn = el('tutorial-prev-btn');
  const nextBtn = el('tutorial-next-btn');
  const doneBtn = el('tutorial-done-btn');
  const modal = el('tutorial-modal');
  const stepsNode = el('tutorial-steps');

  if (!openBtn || !modal || !stepsNode) return;

  const INTERACTIVE_TARGETS = [
    '#location-panel-btn',
    '#open-app-btn',
    '#scan-qr-btn',
    '#manual-location-btn',
    '#chat-thread',
    '.chat-panel',
    '#audio-settings-btn',
    '#audio-controls-panel',
    '#app-title'
  ];

  let currentStep = 0;
  let lastFocus = null;
  let actionAdvancePending = false;
  let waitingForAction = false;

  function items() {
    const steps = t('tutorial.steps', []);
    return Array.isArray(steps) ? steps : [];
  }

  function itemAt(index = currentStep) {
    return items()[index] || {};
  }

  function totalSteps() {
    return Math.max(items().length, 1);
  }

  function isMobile() {
    return window.matchMedia('(max-width: 880px)').matches;
  }

  function isOpen() {
    return document.body.hasAttribute('data-tutorial-open');
  }

  function actionRequired(item = itemAt()) {
    return !!(
      (item.requireLocation && !locationReadyForTutorial()) ||
      (item.waitForQuestion && !questionReady()) ||
      item.waitForVoice ||
      item.waitForSend
    );
  }

  function locationReadyForTutorial() {
    return !!el('artwork-select')?.value;
  }

  function questionReady() {
    return !!el('chat-input')?.value.trim();
  }

  function questionStepIndex() {
    return items().findIndex((item) => item.waitForQuestion);
  }

  function sendStepIndex() {
    return items().findIndex((item) => item.waitForSend || item.target === '#send-btn');
  }

  function firstStepAfterLocationGroup() {
    const nextIndex = items().findIndex((item) => item.group !== 'location');
    return nextIndex < 0 ? currentStep + 1 : nextIndex;
  }

  function stepSelectors(item = itemAt()) {
    if (Array.isArray(item.targets)) return item.targets;
    return [item.targets || item.target].filter(Boolean);
  }

  function targetFor(item = itemAt()) {
    for (const selector of stepSelectors(item)) {
      const target = q(selector);
      if (target && target.offsetParent !== null) return target;
    }
    return null;
  }

  function firstUsableTarget(target) {
    if (!target) return null;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    if (target.matches?.(selector)) return target;
    return q(selector, target);
  }

  function targetContainsEvent(item, eventTarget) {
    return stepSelectors(item).some((selector) => !!eventTarget?.closest?.(selector));
  }

  function focusableNodes() {
    return qa(
      'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      modal
    ).filter((node) => node.offsetParent !== null);
  }

  function clearTarget() {
    qa('.tutorial-target').forEach((node) => node.classList.remove('tutorial-target'));
  }

  function openAudioPanelIfNeeded(item) {
    if (item.openPanel !== 'audio') return;
    const btn = el('audio-settings-btn');
    if (btn?.getAttribute('aria-expanded') !== 'true') btn?.click();
  }

  function closeAudioPanel() {
    const btn = el('audio-settings-btn');
    if (document.body.hasAttribute('data-audio-settings-open') && btn) {
      btn.click();
      return;
    }
    document.body.removeAttribute('data-audio-settings-open');
    btn?.setAttribute('aria-expanded', 'false');
    const icon = btn ? q('.material-symbols-outlined', btn) : null;
    if (icon) icon.textContent = 'tune';
  }

  function openLocationPanelIfNeeded(item) {
    if (item.openPanel !== 'location' && item.openPanel !== 'manualLocation') return;

    const locationBtn = el('location-panel-btn');
    if (locationBtn?.getAttribute('aria-expanded') !== 'true') locationBtn.click();

    if (item.openPanel === 'manualLocation') {
      const manualBtn = el('manual-location-btn');
      const manualPanel = el('manual-location-panel');
      if (manualBtn && manualPanel?.hasAttribute('hidden')) manualBtn.click();
    }
  }

  function prepareTarget(item) {
    openAudioPanelIfNeeded(item);
    openLocationPanelIfNeeded(item);
  }

  function highlightTarget(item = itemAt()) {
    clearTarget();
    prepareTarget(item);

    window.setTimeout(() => {
      const target = targetFor(item);
      if (!target) return;
      const block = isMobile() && modal.getAttribute('data-placement') !== 'top' ? 'start' : 'nearest';

      target.classList.add('tutorial-target');
      target.scrollIntoView({
        behavior: 'smooth',
        block,
        inline: 'nearest'
      });
    }, 80);
  }

  function setActionMode(enabled) {
    waitingForAction = enabled;
    modal.toggleAttribute('data-waiting-action', enabled);
  }

  function startActionMode() {
    const item = itemAt();
    setActionMode(true);
    highlightTarget(item);

    window.setTimeout(() => {
      firstUsableTarget(targetFor(item))?.focus?.();
    }, 120);
  }

  function placePanel(item) {
    const target = item.target || '';
    let placement = 'bottom';
    const actionNearBottom =
      target === '.input-shell' ||
      target === '#mic-btn' ||
      target === '#send-btn' ||
      item.waitForQuestion ||
      item.waitForVoice ||
      item.waitForSend;

    if (actionNearBottom) {
      placement = 'top';
    } else if (item.requireLocation) {
      placement = isMobile() ? 'bottom' : 'left';
    } else if (currentStep >= 5) {
      placement = 'right';
    }

    if (placement === 'bottom') {
      modal.removeAttribute('data-placement');
    } else {
      modal.setAttribute('data-placement', placement);
    }
    if (isOpen()) document.body.setAttribute('data-tutorial-placement', placement);
    else document.body.removeAttribute('data-tutorial-placement');
  }

  function goToStep(index) {
    const maxIndex = Math.max(totalSteps() - 1, 0);
    setActionMode(false);
    currentStep = Math.max(0, Math.min(index, maxIndex));
    renderCurrentStep();
  }

  function goNext() {
    if (currentStep >= totalSteps() - 1) return;
    goToStep(currentStep + 1);
  }

  function goToSendStep() {
    const index = sendStepIndex();
    if (index >= 0) goToStep(index);
    else goNext();
  }

  function advanceAfterAction(callback = goNext) {
    if (actionAdvancePending) return;
    actionAdvancePending = true;

    window.setTimeout(() => {
      setActionMode(false);
      callback();
      actionAdvancePending = false;
    }, 250);
  }

  function renderStaticLabels() {
    setText(el('tutorial-open-text'), t('tutorial.open', 'Help'));
    setAttribute(el('tutorial-open-btn'), 'aria-label', t('tutorial.openLabel', 'Help: how to use GuIA'));
    setAttribute(el('tutorial-open-btn'), 'title', t('tutorial.openLabel', 'Help: how to use GuIA'));
    setText(el('tutorial-kicker'), t('tutorial.kicker', 'Help'));
    setText(el('tutorial-title'), t('tutorial.title', 'How to use GuIA'));
    setText(el('tutorial-intro'), t('tutorial.intro', 'One step at a time.'));
    setText(prevBtn, t('tutorial.previous', 'Back'));
    setText(nextBtn, t('tutorial.next', 'Next'));
    setText(doneBtn, t('tutorial.done', 'Got it'));
    setAttribute(closeBtn, 'aria-label', t('tutorial.close', 'Close help'));
  }

  function buildStepCard(item) {
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
      .replace('{total}', totalSteps());

    const title = document.createElement('h3');
    title.textContent = item.title || '';

    const body = document.createElement('p');
    body.textContent = item.body || '';

    content.append(progress, title, body);
    card.append(icon, content);
    return card;
  }

  function renderCurrentStep() {
    const item = itemAt();

    placePanel(item);
    renderStaticLabels();

    stepsNode.textContent = '';
    stepsNode.appendChild(buildStepCard(item));

    if (prevBtn) prevBtn.disabled = currentStep === 0;
    if (nextBtn) {
      nextBtn.hidden = currentStep >= totalSteps() - 1;
      nextBtn.disabled = false;
    }
    if (doneBtn) doneBtn.hidden = currentStep < totalSteps() - 1;

    if (isOpen()) highlightTarget(item);
    else clearTarget();
  }

  function openTutorial() {
    lastFocus = document.activeElement;
    currentStep = 0;
    actionAdvancePending = false;

    clearTarget();
    modal.removeAttribute('data-placement');
    document.body.removeAttribute('data-tutorial-placement');
    setActionMode(false);

    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.setAttribute('data-tutorial-open', '');

    renderCurrentStep();
  }

  function closeTutorial() {
    clearTarget();
    setActionMode(false);
    closeAudioPanel();

    modal.removeAttribute('data-placement');
    document.body.removeAttribute('data-tutorial-placement');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('hidden', '');
    modal.hidden = true;
    document.body.removeAttribute('data-tutorial-open');

    const playbackBtn = el('audio-playback-btn');
    if (playbackBtn?.getAttribute('aria-pressed') === 'true') playbackBtn.click();

    requestAnimationFrame(() => lastFocus?.focus?.());

    window.setTimeout(() => {
      if (!document.body.hasAttribute('data-onboarding-open')) {
        window.guiaSuppressAppShellForWelcome?.();
        window.guiaSpeakInitialWelcome?.();
      }
    }, 0);
  }

  function handlePageClick(event) {
    if (!isOpen() || event.target.closest?.('#tutorial-modal')) return;

    const item = itemAt();

    if ((item.qrAction || item.target === '#scan-qr-btn') && event.target.closest?.('#close-qr-btn')) {
      advanceAfterAction();
      return;
    }

    if (actionRequired(item) && !waitingForAction) {
      startActionMode();
      return;
    }

    if (!waitingForAction) return;

    if (item.waitForQuestion && event.target.closest?.('.input-shell')) {
      el('chat-input')?.focus();
      if (questionReady()) advanceAfterAction();
      return;
    }

    if (item.requireLocation && event.target.closest?.('#set-context-btn')) {
      const artworkSelected = !!el('artwork-select')?.value;
      if (!artworkSelected) {
        event.preventDefault();
        event.stopPropagation();
        const error = el('context-error');
        if (error) error.textContent = t('app.artworkRequired', 'Choose an artwork before continuing.');
        el('artwork-select')?.focus();
        return;
      }
      return;
    }

    if (item.requireLocation) return;

    if (item.waitForVoice && event.target.closest?.('#mic-btn')) return;

    if (item.waitForSend && event.target.closest?.('#send-btn')) {
      if (questionReady()) advanceAfterAction();
      else {
        const index = questionStepIndex();
        if (index >= 0) goToStep(index);
        el('chat-input')?.focus();
      }
      return;
    }

    if (targetContainsEvent(item, event.target) || targetContainsEvent({ targets: INTERACTIVE_TARGETS }, event.target)) {
      if (currentStep >= totalSteps() - 1) window.setTimeout(closeTutorial, 250);
      else advanceAfterAction();
    }
  }

  function handleLocationSelected() {
    if (!isOpen()) return;

    const item = itemAt();
    if (item.requireLocation && locationReadyForTutorial() && state.currentArtwork) {
      advanceAfterAction(() => goToStep(firstStepAfterLocationGroup()));
    }
  }

  function handleQuestionInput(event) {
    if (!isOpen()) return;

    const item = itemAt();
    if (!event.target.value.trim()) return;
    if (item.waitForQuestion) advanceAfterAction();
    if (item.waitForVoice) advanceAfterAction(goToSendStep);
  }

  function handleModalKeydown(event) {
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

    const focusables = focusableNodes();
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
  }

  function handleNextClick() {
    const item = itemAt();

    if (actionRequired(item)) {
      startActionMode();
      return;
    }

    if (item.openPanel === 'audio' || item.target === '#audio-controls-panel') {
      closeAudioPanel();
    }

    goNext();
  }

  modal.addEventListener('keydown', handleModalKeydown);
  openBtn.addEventListener('click', openTutorial);
  closeBtn?.addEventListener('click', closeTutorial);
  doneBtn?.addEventListener('click', closeTutorial);
  prevBtn?.addEventListener('click', () => {
    if (currentStep > 0) goToStep(currentStep - 1);
  });
  nextBtn?.addEventListener('click', handleNextClick);

  document.addEventListener('click', handlePageClick, true);
  document.addEventListener('guia:location-selected', handleLocationSelected);
  el('chat-input')?.addEventListener('input', handleQuestionInput);

  window.guiaOpenTutorial = openTutorial;
  window.guiaApplyTutorialTranslations = renderCurrentStep;
  renderCurrentStep();
}

function renderTutorial() {
  window.guiaApplyTutorialTranslations?.();
}
