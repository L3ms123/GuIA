// Onboarding
function showOnboarding() {
  state.lastFocusedElement = document.activeElement;
  window.guiaResetSpeechQueue?.();
  syncAccessibilityControls();
  const onboarding = el('onboarding');
  const appShell = q('.app-shell');
  onboarding.style.display = 'flex';
  onboarding.removeAttribute('aria-hidden');
  // Ensure onboarding is interactive when shown (remove any leftover inert)
  onboarding.removeAttribute('inert');
  appShell?.setAttribute('inert', '');
  document.body.toggleAttribute('data-onboarding-open', true);

  const stepToShow = Number.isInteger(state.onboardingStep)
    ? Math.min(Math.max(state.onboardingStep, 1), state.totalSteps)
    : 1;

  showOnboardingStep(stepToShow);
  window.setTimeout(() => focusFirstAvailable(onboarding), 0);
}

function hideOnboarding() {
  const onboarding = el('onboarding');
  const appShell = q('.app-shell');

  document.activeElement?.blur();

  const previous = state.lastFocusedElement;

  onboarding.setAttribute('inert', '');
  onboarding.setAttribute('aria-hidden', 'true');
  onboarding.style.display = 'none';
  appShell?.removeAttribute('inert');
  document.body.removeAttribute('data-onboarding-open');

  requestAnimationFrame(() => {
    previous?.focus?.();
  });
  
}

function initOnboardingFocusTrap() {
  const onboarding = el('onboarding');
  if (!onboarding) return;

  onboarding.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const focusable = qa(
      'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])',
      onboarding
    ).filter((node) => node.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function initAppTitleButton() {
  const appTitle = el('app-title');
  if (!appTitle) return;

  appTitle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showOnboarding();
  });
}

function applyOnboardingTranslations() {
  if (!state.translations[state.selectedLang]) return;
  document.documentElement.lang = state.selectedLang || 'ca';

  setText(q('.eyebrow'), t('onboarding.eyebrow'));
  setText(el('onboarding-title'), t('onboarding.title'));
  setText(el('onboarding-desc'), t('onboarding.description'));
  setText(el('label-language'), t('onboarding.language'));
  setText(el('label-personality'), t('onboarding.personality'));
  setText(el('label-visitor'), t('onboarding.visitor'));

  PERSONA_KEYS.forEach((key) => {
    const btn = q(`[data-persona="${key}"]`);
    if (!btn) return;
    const titleNode = btn.querySelector('.card-title');
    const subNode = btn.querySelector('.card-subtitle');
    setText(titleNode, t(`personas.${key}.title`));
    setText(subNode, t(`personas.${key}.subtitle`));
  });

  AGE_KEYS.forEach((key) => {
    const btn = q(`[data-age="${key}"]`);
    if (!btn) return;
    let title = btn.querySelector('.age-title');
    const sub = btn.querySelector('.card-subtitle');

    if (!title) {
      title = document.createElement('span');
      title.className = 'age-title';
      const icon = btn.querySelector('.chip-icon');
      if (icon) {
        icon.insertAdjacentElement('afterend', title);
      } else {
        btn.prepend(title);
      }
    }

    for (const node of Array.from(btn.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        node.textContent = '';
      }
    }

    setText(title, t(`ages.${key}.title`));
    setText(sub, t(`ages.${key}.subtitle`));
  });

  setText(el('age-hint'), t('ageHint'));
  setText(el('label-accessibility'), t('onboarding.accessibility'));
  setText(el('accessibility-help'), t('onboarding.accessibilityHelp'));

  const optLargeTextLabel =
    q('label[for="opt-large-text"] span') ||
    q('#opt-large-text')?.closest('label')?.querySelector('span');
  setText(optLargeTextLabel, t('onboarding.largeText'));

  const optSimpleLanguageLabel =
    q('label[for="opt-simple-language"] span') ||
    q('#opt-simple-language')?.closest('label')?.querySelector('span');
  setText(optSimpleLanguageLabel, t('onboarding.simpleLanguage'));
  const optSimpleLanguageHelp = q('#opt-simple-language')?.closest('label')?.querySelector('.card-subtitle');
  setText(optSimpleLanguageHelp, t('onboarding.simpleLanguageHelp'));

  const optSpokenAudioLabel =
    q('label[for="opt-spoken-audio"] span') ||
    q('#opt-spoken-audio')?.closest('label')?.querySelector('span');
  setText(optSpokenAudioLabel, t('onboarding.spokenExplanations'));
  const optSpokenAudioHelp = q('#opt-spoken-audio')?.closest('label')?.querySelector('.card-subtitle');
  setText(optSpokenAudioHelp, t('onboarding.spokenExplanationsHelp'));

  const optMoreTimeLabel =
    q('label[for="opt-more-time"] span') ||
    q('#opt-more-time')?.closest('label')?.querySelector('span');
  setText(optMoreTimeLabel, t('onboarding.moreTime'));
  const optMoreTimeHelp = q('#opt-more-time')?.closest('label')?.querySelector('.card-subtitle');
  setText(optMoreTimeHelp, t('onboarding.moreTimeHelp'));

  const optVisualDescriptionsLabel = q('#opt-visual-descriptions')?.closest('label')?.querySelector('span');
  setText(optVisualDescriptionsLabel, t('onboarding.visualDescriptions'));
  const optVisualDescriptionsHelp = q('#opt-visual-descriptions')?.closest('label')?.querySelector('.card-subtitle');
  setText(optVisualDescriptionsHelp, t('onboarding.visualDescriptionsHelp'));

  const privacyHeading = el('privacy-notice-title') || q('.onboarding-step[data-step="3"] .section-label');
  setText(privacyHeading, t('onboarding.privacy'));
  setText(el('privacy-notice-summary'), t('onboarding.privacyNoticeSummary'));

  const privacyParagraphs = qa('#privacy-notice-text p');
  setText(privacyParagraphs[0], t('onboarding.privacyIntro1'));
  setText(privacyParagraphs[1], t('onboarding.privacyIntro2'));
  setText(privacyParagraphs[2], t('onboarding.privacyIntro3'));
  setText(privacyParagraphs[3], t('onboarding.privacyIntro4'));
  setText(privacyParagraphs[4], t('onboarding.privacyIntro5'));

  const consentLabel = q('#privacy-consent')?.closest('label')?.querySelector('span');
  setText(consentLabel, t('onboarding.privacyConsent'));

  updateOnboardingButtons();
  syncAccessibilityControls();
}

function onboardingEls() {
  return {
    steps: qa('.onboarding-step'),
    backBtn: el('onboarding-back'),
    nextBtn: el('onboarding-next'),
    stepCount: el('step-count'),
    stepFill: q('.step-bar-fill'),
    consent: el('privacy-consent')
  };
}

function showOnboardingStep(step) {
  state.onboardingStep = step;
  const { steps, backBtn, nextBtn, stepCount, stepFill } = onboardingEls();
  const onboardingPanel = q('.onboarding-panel');
  const onboardingBody = q('.onboarding-body');

  steps.forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });

  requestAnimationFrame(() => {
    if (onboardingPanel) onboardingPanel.scrollTop = 0;
    if (onboardingBody) onboardingBody.scrollTop = 0;
  });

  if (stepFill) {
    const percent = (step / state.totalSteps) * 100;
    stepFill.style.width = `${percent}%`;
  }

  backBtn.hidden = step === 1;
  nextBtn.textContent = step === state.totalSteps ? 'Start' : 'Continue';

  const desc = el('onboarding-desc');
  if (desc) {
    if (translationsLoaded || state.selectedLang !== 'ca') {
      if (step === 1) {
        desc.textContent = t('onboarding.description');
        desc.hidden = false;
      } else if (step === 2) {
        desc.textContent = t('onboarding.accessibilityHelp');
        desc.hidden = false;
      } else {
        desc.hidden = true;
      }
    } else {
      if (step === 3) {
        desc.hidden = true;
      } else {
        desc.hidden = false;
      }
    }

    if (desc.hidden) {
      el('onboarding')?.removeAttribute('aria-describedby');
    } else {
      el('onboarding')?.setAttribute('aria-describedby', 'onboarding-desc');
    }
  }

  updateOnboardingButtons();
  window.setTimeout(() => {
    if (step === 3) {
      el('privacy-notice')?.focus();
      return;
    }

    focusFirstAvailable(steps.find((section) => !section.hidden));
  }, 0);
}

function updateOnboardingButtons() {
  const backBtn = el('onboarding-back');
  const nextBtn = el('onboarding-next');
  const stepCount = el('step-count');
  const consent = el('privacy-consent');
  const useTranslations = translationsLoaded || state.selectedLang !== 'ca';

  if (stepCount && useTranslations) {
    const template = t('onboarding.stepCount', 'Step {current} of {total}');
    stepCount.textContent = template
      .replace('{current}', state.onboardingStep)
      .replace('{total}', state.totalSteps);
  }

  if (backBtn) {
    if (useTranslations) backBtn.textContent = t('onboarding.back', 'Back');
    backBtn.hidden = state.onboardingStep === 1;
  }

  if (nextBtn) {
    if (useTranslations) {
      nextBtn.textContent =
        state.onboardingStep === state.totalSteps
          ? t('onboarding.start', 'Start')
          : t('onboarding.continue', 'Continue');
    }
  }

  let valid = false;

  if (state.onboardingStep === 1) {
    valid = !!state.selectedPersona && !!state.selectedLang;
  } else if (state.onboardingStep === 2) {
    valid = true;
  } else if (state.onboardingStep === 3) {
    valid = !!consent?.checked;
  }

  if (nextBtn) nextBtn.disabled = !valid;
}

function applyAccessibilityPrefs() {
  document.body.toggleAttribute('data-large-text', state.accessibilityPrefs.largeText);
  document.body.toggleAttribute('data-simple-language', state.accessibilityPrefs.simpleLanguage);
  document.body.toggleAttribute('data-spoken-audio', state.accessibilityPrefs.spokenAudio);
  document.body.toggleAttribute('data-more-time', state.accessibilityPrefs.moreTime);
  document.body.toggleAttribute('data-visual-descriptions', state.accessibilityPrefs.visualDescriptions);

  document.body.setAttribute('data-mode', state.accessibilityPrefs.largeText ? 'larger' : 'regular');

  if (state.accessibilityPrefs.moreTime) {
    setPreferredSpeechSpeed('slow');
  }
  window.guiaUpdateSpokenAudio?.();
  window.guiaReleaseAudioWaiters?.();
}

function syncAccessibilityControls() {
  const preferences = {
    'opt-large-text': 'largeText',
    'opt-simple-language': 'simpleLanguage',
    'opt-spoken-audio': 'spokenAudio',
    'opt-more-time': 'moreTime',
    'opt-visual-descriptions': 'visualDescriptions'
  };

  Object.entries(preferences).forEach(([id, preference]) => {
    const input = el(id);
    if (input) input.checked = !!state.accessibilityPrefs[preference];
  });
}

function setPreferredSpeechSpeed(speed) {
  const btn = q(`.speed-btn[data-speed="${speed}"]`);
  if (btn && btn.getAttribute('aria-checked') !== 'true') {
    btn.click();
  }
}

function bindAccessibilityPreference(id, preference) {
  el(id)?.addEventListener('change', (event) => {
    const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;

    state.accessibilityPrefs[preference] = event.target.checked;

    syncAccessibilityControls();
    applyAccessibilityPrefs();

    if (preference === 'spokenAudio' && state.chatStarted) {
      if (document.body.hasAttribute('data-onboarding-open')) {
        state.deferredSpokenAudioChange = {
          wasEnabled: wasSpokenAudio,
          isEnabled: state.accessibilityPrefs.spokenAudio
        };
      } else {
        window.guiaHandleNarrationPreferenceChange?.(wasSpokenAudio, state.accessibilityPrefs.spokenAudio);
      }
    }
  });
}

function bindOnboardingFlow() {
  const { backBtn, nextBtn, consent } = onboardingEls();

  function finishOnboarding() {
    state.chatStarted = true;
    if (state.accessibilityPrefs.visualDescriptions) {
      state.accessibilityPrefs.spokenAudio = true;
    }
    applyAppTranslations();
    applyAccessibilityPrefs();
    syncAccessibilityControls();
    hideOnboarding();
    if (state.deferredSpokenAudioChange) {
      const { wasEnabled, isEnabled } = state.deferredSpokenAudioChange;
      state.deferredSpokenAudioChange = null;
      window.guiaHandleNarrationPreferenceChange?.(wasEnabled, isEnabled);
    }
    window.guiaSpeakInitialWelcome?.();
  }

  qa('.interaction-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedInteraction = btn.dataset.interaction;
      qa('.interaction-card').forEach((card) => {
        card.setAttribute('aria-checked', String(card === btn));
      });
      updateOnboardingButtons();
    });
  });

  bindAccessibilityPreference('opt-large-text', 'largeText');
  bindAccessibilityPreference('opt-simple-language', 'simpleLanguage');
  bindAccessibilityPreference('opt-spoken-audio', 'spokenAudio');
  bindAccessibilityPreference('opt-more-time', 'moreTime');
  bindAccessibilityPreference('opt-visual-descriptions', 'visualDescriptions');
  initEnterToggleCheckboxes();
  syncAccessibilityControls();

  consent?.addEventListener('change', updateOnboardingButtons);

  backBtn?.addEventListener('click', () => {
    if (state.onboardingStep > 1) showOnboardingStep(state.onboardingStep - 1);
  });

  nextBtn?.addEventListener('click', () => {
    if (state.onboardingStep < state.totalSteps) {
      showOnboardingStep(state.onboardingStep + 1);
      return;
    }

    state.privacyAccepted = true;
    finishOnboarding();
  });

  showOnboardingStep(1);
}

function initOnboardingKeyboardSupport() {
  initRadioGroupKeyboard('#language-group', '[data-lang]');
  initRadioGroupKeyboard('#persona-group', '[data-persona]');
  initRadioGroupKeyboard('#age-group', '[data-age]');
}
