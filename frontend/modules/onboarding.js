// Onboarding
function showOnboarding() {
  state.lastFocusedElement = document.activeElement;
  state.onboardingStep = 1;
  window.guiaResetSpeechQueue?.();
  syncAccessibilityControls();
  applyAccessibilityPrefs();
  const onboarding = el('onboarding');
  const appShell = q('.app-shell');
  onboarding.style.display = 'flex';
  onboarding.removeAttribute('aria-hidden');
  // Ensure onboarding is interactive when shown (remove any leftover inert)
  onboarding.removeAttribute('inert');
  appShell?.setAttribute('inert', '');
  document.body.toggleAttribute('data-onboarding-open', true);

  showOnboardingStep(1);
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
    showSettingsPanel();
  });
}

function settingsEls() {
  return {
    modal: el('settings-modal'),
    closeBtn: el('settings-close-btn'),
    doneBtn: el('settings-done-btn'),
    resetBtn: el('settings-reset-btn'),
    tutorialInput: el('settings-start-tutorial')
  };
}

function showSettingsPanel() {
  const { modal } = settingsEls();
  if (!modal) return;

  state.lastFocusedElement = document.activeElement;
  window.guiaResetSpeechQueue?.();
  document.body.removeAttribute('data-location-panel-open');
  document.body.removeAttribute('data-audio-settings-open');
  el('location-panel-btn')?.setAttribute('aria-expanded', 'false');
  el('audio-settings-btn')?.setAttribute('aria-expanded', 'false');
  syncSettingsControls();
  applySettingsTranslations();

  modal.hidden = false;
  modal.removeAttribute('hidden');
  modal.removeAttribute('aria-hidden');
  document.body.toggleAttribute('data-settings-open', true);

  window.setTimeout(() => focusFirstAvailable(modal), 0);
}

function hideSettingsPanel() {
  const { modal } = settingsEls();
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('hidden', '');
  modal.hidden = true;
  document.body.removeAttribute('data-settings-open');
  requestAnimationFrame(() => state.lastFocusedElement?.focus?.());
}

function applyOnboardingTranslations() {
  if (!state.translations[state.selectedLang]) return;
  document.documentElement.lang = state.selectedLang || 'ca';

  function setOptionalHeading(node, text) {
    if (!node) return;

    node.textContent = text;
    const optional = document.createElement('span');
    optional.className = 'sr-only';
    optional.textContent = ` ${t('onboarding.optional', '(optional)')}`;
    node.append(optional);
  }

  setText(q('.eyebrow'), t('onboarding.eyebrow'));
  setText(el('onboarding-title'), t('onboarding.title'));
  setText(el('label-language'), t('onboarding.language'));
  setText(el('label-personality'), t('onboarding.personality'));
  setOptionalHeading(el('label-visitor'), t('onboarding.visitor'));

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
  setOptionalHeading(el('label-accessibility'), t('onboarding.accessibility'));
  setText(el('accessibility-help'), t('onboarding.accessibilityHelp'));

  const optLargeTextLabel =
    q('label[for="opt-large-text"] .toggle-content > span') ||
    q('#opt-large-text')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optLargeTextLabel, t('onboarding.largeText'));
  const optLargeTextHelp = q('#opt-large-text')?.closest('label')?.querySelector('.card-subtitle');
  setText(optLargeTextHelp, t('onboarding.largeTextHelp'));

  const optUppercaseTextLabel = q('#opt-uppercase-text')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optUppercaseTextLabel, t('onboarding.uppercaseText'));
  const optUppercaseTextHelp = q('#opt-uppercase-text')?.closest('label')?.querySelector('.card-subtitle');
  setText(optUppercaseTextHelp, t('onboarding.uppercaseTextHelp'));

  const optSimpleLanguageLabel =
    q('label[for="opt-simple-language"] .toggle-content > span') ||
    q('#opt-simple-language')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optSimpleLanguageLabel, t('onboarding.simpleLanguage'));
  const optSimpleLanguageHelp = q('#opt-simple-language')?.closest('label')?.querySelector('.card-subtitle');
  setText(optSimpleLanguageHelp, t('onboarding.simpleLanguageHelp'));

  const optSpokenAudioLabel =
    q('label[for="opt-spoken-audio"] .toggle-content > span') ||
    q('#opt-spoken-audio')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optSpokenAudioLabel, t('onboarding.spokenExplanations'));
  const optSpokenAudioHelp = q('#opt-spoken-audio')?.closest('label')?.querySelector('.card-subtitle');
  setText(optSpokenAudioHelp, t('onboarding.spokenExplanationsHelp'));

  const optMoreTimeLabel =
    q('label[for="opt-more-time"] .toggle-content > span') ||
    q('#opt-more-time')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optMoreTimeLabel, t('onboarding.moreTime'));
  const optMoreTimeHelp = q('#opt-more-time')?.closest('label')?.querySelector('.card-subtitle');
  setText(optMoreTimeHelp, t('onboarding.moreTimeHelp'));

  const optVisualDescriptionsLabel = q('#opt-visual-descriptions')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optVisualDescriptionsLabel, t('onboarding.visualDescriptions'));
  const optVisualDescriptionsHelp = q('#opt-visual-descriptions')?.closest('label')?.querySelector('.card-subtitle');
  setText(optVisualDescriptionsHelp, t('onboarding.visualDescriptionsHelp'));

  setText(el('label-tutorial-choice'), t('onboarding.tutorial'));
  const optStartTutorialLabel = q('#opt-start-tutorial')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optStartTutorialLabel, t('onboarding.startTutorial'));
  const optStartTutorialHelp = q('#opt-start-tutorial')?.closest('label')?.querySelector('.card-subtitle');
  setText(optStartTutorialHelp, t('onboarding.startTutorialHelp'));

  const privacyHeading = el('privacy-notice-title') || q('.onboarding-step[data-step="3"] .section-label');
  setText(privacyHeading, t('onboarding.privacy'));

  const privacyParagraphs = qa('#privacy-notice-text p');
  setText(privacyParagraphs[0], t('onboarding.privacyIntro1'));
  setText(privacyParagraphs[1], t('onboarding.privacyIntro2'));
  setText(privacyParagraphs[2], t('onboarding.privacyIntro3'));
  setText(privacyParagraphs[3], t('onboarding.privacyIntro4'));
  setText(privacyParagraphs[4], t('onboarding.privacyIntro5'));

  const consentLabel = q('#privacy-consent')?.closest('label')?.querySelector('span');
  setText(consentLabel, t('onboarding.privacyConsent'));

  enhanceOnboardingAccessibility();
  updateOnboardingButtons();
  syncAccessibilityControls();
  applySettingsTranslations();
}

function enhanceOnboardingAccessibility() {
  [
    'opt-large-text',
    'opt-uppercase-text',
    'opt-simple-language',
    'opt-spoken-audio',
    'opt-more-time',
    'opt-visual-descriptions',
    'opt-start-tutorial'
  ].forEach((id) => {
    const input = el(id);
    const row = input?.closest('label');
    const label = row?.querySelector('.toggle-content span');
    const help = row?.querySelector('.card-subtitle');
    if (!input || !label) return;
    if (!label.id) label.id = `${id}-label`;
    input.setAttribute('aria-labelledby', label.id);
    if (help) {
      if (!help.id) help.id = `${id}-help`;
      input.setAttribute('aria-describedby', help.id);
    }
  });
}

function applySettingsTranslations() {
  const { modal, closeBtn, doneBtn, resetBtn } = settingsEls();
  if (!modal || !state.translations[state.selectedLang]) return;

  setText(el('settings-kicker'), t('settings.kicker', 'Settings'));
  setText(el('settings-title'), t('settings.title', 'Change settings'));
  setText(el('settings-help'), t('settings.help', 'Change one option at a time. Changes are saved automatically.'));
  setText(el('settings-language-title'), t('onboarding.language', 'Select language'));
  setText(el('settings-guide-title'), t('onboarding.personality', 'How do you want the guide to help you?'));
  setText(el('settings-age-title'), t('onboarding.visitor', 'Select age range'));
  setText(el('settings-accessibility-title'), t('settings.accessibility', 'Help options'));
  setText(doneBtn, t('settings.done', 'Done'));
  setText(resetBtn, t('app.restartSession', 'Restart session'));
  setAttribute(closeBtn, 'aria-label', t('settings.close', 'Close settings'));

  PERSONA_KEYS.forEach((key) => {
    const btn = q(`[data-settings-persona="${key}"]`);
    if (!btn) return;
    setText(btn.querySelector('.card-title'), t(`personas.${key}.title`));
    setText(btn.querySelector('.card-subtitle'), t(`personas.${key}.subtitle`));
  });

  AGE_KEYS.forEach((key) => {
    const btn = q(`[data-settings-age="${key}"]`);
    if (!btn) return;
    setText(btn.querySelector('.age-title'), t(`ages.${key}.title`));
    setText(btn.querySelector('.card-subtitle'), t(`ages.${key}.subtitle`));
  });

  const preferenceLabels = {
    largeText: ['onboarding.largeText', 'onboarding.largeTextHelp'],
    uppercaseText: ['onboarding.uppercaseText', 'onboarding.uppercaseTextHelp'],
    simpleLanguage: ['onboarding.simpleLanguage', 'onboarding.simpleLanguageHelp'],
    spokenAudio: ['onboarding.spokenExplanations', 'onboarding.spokenExplanationsHelp'],
    moreTime: ['onboarding.moreTime', 'onboarding.moreTimeHelp'],
    visualDescriptions: ['onboarding.visualDescriptions', 'onboarding.visualDescriptionsHelp']
  };

  Object.entries(preferenceLabels).forEach(([preference, keys]) => {
    setText(q(`[data-settings-label="${preference}"]`), t(keys[0]));
    setText(q(`[data-settings-help="${preference}"]`), t(keys[1]));
  });

  setText(el('settings-start-tutorial-label'), t('onboarding.startTutorial'));
  setText(el('settings-start-tutorial-help'), t('onboarding.startTutorialHelp'));
  enhanceSettingsAccessibility();
}

function enhanceSettingsAccessibility() {
  qa('[data-settings-lang], [data-settings-persona]').forEach((btn, index) => {
    const title = btn.querySelector('.card-title');
    const help = btn.querySelector('.card-subtitle');
    if (title && !title.id) title.id = `settings-card-title-${index}`;
    if (help && !help.id) help.id = `settings-card-help-${index}`;
    if (title) btn.setAttribute('aria-labelledby', title.id);
    if (help) btn.setAttribute('aria-describedby', help.id);
  });

  qa('[data-settings-age]').forEach((btn, index) => {
    const title = btn.querySelector('.age-title');
    const help = btn.querySelector('.card-subtitle');
    if (title && !title.id) title.id = `settings-age-title-${index}`;
    if (help && !help.id) help.id = `settings-age-help-${index}`;
    if (title) btn.setAttribute('aria-labelledby', title.id);
    if (help) btn.setAttribute('aria-describedby', help.id);
  });

  qa('[data-settings-pref]').forEach((input) => {
    const preference = input.dataset.settingsPref;
    const label = q(`[data-settings-label="${preference}"]`);
    const help = q(`[data-settings-help="${preference}"]`);
    if (label && !label.id) label.id = `settings-${preference}-label`;
    if (help && !help.id) help.id = `settings-${preference}-help`;
    if (label) input.setAttribute('aria-labelledby', label.id);
    if (help) input.setAttribute('aria-describedby', help.id);
  });

  const tutorialInput = el('settings-start-tutorial');
  if (tutorialInput) {
    tutorialInput.setAttribute('aria-labelledby', 'settings-start-tutorial-label');
    tutorialInput.setAttribute('aria-describedby', 'settings-start-tutorial-help');
  }
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
  applyAccessibilityPrefs();
  const { steps, backBtn, nextBtn, stepCount, stepFill } = onboardingEls();
  const onboardingPanel = q('.onboarding-panel');
  const onboardingBody = q('.onboarding-body');
  const visibleTotalSteps = state.privacyAccepted ? 2 : state.totalSteps;

  steps.forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });

  requestAnimationFrame(() => {
    if (onboardingPanel) onboardingPanel.scrollTop = 0;
    if (onboardingBody) onboardingBody.scrollTop = 0;
  });

  if (stepFill) {
    const percent = (Math.min(step, visibleTotalSteps) / visibleTotalSteps) * 100;
    stepFill.style.width = `${percent}%`;
  }

  updateBackButtonState(backBtn, step === 1);
  nextBtn.textContent = step === state.totalSteps || (state.privacyAccepted && step === 2) ? 'Start' : 'Continue';

  el('onboarding')?.setAttribute('aria-describedby', 'step-count');

  updateOnboardingButtons();
  window.setTimeout(() => {
    if (step === 3) {
      el('privacy-notice')?.focus();
      return;
    }

    focusFirstAvailable(steps.find((section) => !section.hidden));
  }, 0);
}

function updateBackButtonState(backBtn, isFirstStep) {
  if (!backBtn) return;

  backBtn.hidden = isFirstStep;
  backBtn.disabled = isFirstStep;
  backBtn.setAttribute('aria-hidden', isFirstStep ? 'true' : 'false');
  backBtn.setAttribute('tabindex', isFirstStep ? '-1' : '0');
}

function updateOnboardingButtons() {
  const backBtn = el('onboarding-back');
  const nextBtn = el('onboarding-next');
  const stepCount = el('step-count');
  const consent = el('privacy-consent');
  const useTranslations = translationsLoaded || state.selectedLang !== 'ca';
  const visibleTotalSteps = state.privacyAccepted ? 2 : state.totalSteps;

  if (stepCount && useTranslations) {
    const template = t('onboarding.stepCount', 'Step {current} of {total}');
    const stepDescription = t(`onboarding.stepDescriptions.${state.onboardingStep}`, '');
    const stepLabel = template
      .replace('{current}', state.onboardingStep)
      .replace('{total}', visibleTotalSteps);
    stepCount.textContent = stepDescription ? `${stepLabel} - ${stepDescription}` : stepLabel;
  }

  if (backBtn) {
    if (useTranslations) backBtn.textContent = t('onboarding.back', 'Back');
    updateBackButtonState(backBtn, state.onboardingStep === 1);
  }

  if (nextBtn) {
    if (useTranslations) {
      nextBtn.textContent =
        state.onboardingStep === state.totalSteps || (state.privacyAccepted && state.onboardingStep === 2)
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
  const visualTargets = [
    document.documentElement,
    document.body,
    el('onboarding'),
    el('settings-modal'),
    q('.app-shell')
  ].filter(Boolean);

  visualTargets.forEach((target) => {
    target.toggleAttribute('data-large-text', state.accessibilityPrefs.largeText);
    target.toggleAttribute('data-uppercase-text', state.accessibilityPrefs.uppercaseText);
  });

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
    'opt-uppercase-text': 'uppercaseText',
    'opt-simple-language': 'simpleLanguage',
    'opt-spoken-audio': 'spokenAudio',
    'opt-more-time': 'moreTime',
    'opt-visual-descriptions': 'visualDescriptions'
  };

  Object.entries(preferences).forEach(([id, preference]) => {
    const input = el(id);
    if (input) input.checked = !!state.accessibilityPrefs[preference];
  });

  const tutorialInput = el('opt-start-tutorial');
  if (tutorialInput) tutorialInput.checked = !!state.showTutorialOnStart;
  syncSettingsControls();
}

function syncSettingsControls() {
  qa('[data-settings-lang]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.settingsLang === state.selectedLang ? 'true' : 'false');
  });

  qa('[data-settings-persona]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.settingsPersona === state.selectedPersona ? 'true' : 'false');
  });

  qa('[data-settings-age]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.settingsAge === state.selectedAge ? 'true' : 'false');
  });

  qa('[data-settings-pref]').forEach((input) => {
    input.checked = !!state.accessibilityPrefs[input.dataset.settingsPref];
  });

  const tutorialInput = el('settings-start-tutorial');
  if (tutorialInput) tutorialInput.checked = !!state.showTutorialOnStart;
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
    window.saveGuiaSession?.();

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

function bindSettingsPanel() {
  const { modal, closeBtn, doneBtn, resetBtn, tutorialInput } = settingsEls();
  if (!modal) return;

  closeBtn?.addEventListener('click', hideSettingsPanel);
  doneBtn?.addEventListener('click', hideSettingsPanel);
  resetBtn?.addEventListener('click', () => {
    hideSettingsPanel();
    window.restartGuiaSession?.();
  });

  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideSettingsPanel();
    }
  });

  qa('[data-settings-lang]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.selectedLang === btn.dataset.settingsLang) return;
      if (state.chatGenerating || state.conversationTranslating) {
        announce(t('chat.languageChangeBusy', 'Wait until the current response or translation finishes before changing language.'));
        return;
      }
      const previousLang = state.selectedLang;
      state.selectedLang = btn.dataset.settingsLang;
      selectRadio(qa('#language-group [data-lang]'), q(`#language-group [data-lang="${state.selectedLang}"]`));
      syncSettingsControls();
      await applyLanguageChange(previousLang);
      applySettingsTranslations();
      window.saveGuiaSession?.();
    });
  });

  qa('[data-settings-persona]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedPersona = btn.dataset.settingsPersona;
      selectRadio(qa('[data-persona]'), q(`[data-persona="${state.selectedPersona}"]`));
      syncSettingsControls();
      updateOnboardingButtons();
      window.saveGuiaSession?.();
    });
  });

  qa('[data-settings-age]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedAge = state.selectedAge === btn.dataset.settingsAge ? null : btn.dataset.settingsAge;
      selectRadio(qa('[data-age]'), state.selectedAge ? q(`[data-age="${state.selectedAge}"]`) : null);
      if (!state.selectedAge) qa('[data-age]').forEach((ageBtn) => ageBtn.setAttribute('aria-checked', 'false'));
      syncSettingsControls();
      window.saveGuiaSession?.();
    });
  });

  qa('[data-settings-pref]').forEach((input) => {
    input.addEventListener('change', (event) => {
      const preference = event.target.dataset.settingsPref;
      const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;
      state.accessibilityPrefs[preference] = event.target.checked;
      syncAccessibilityControls();
      applyAccessibilityPrefs();
      window.saveGuiaSession?.();

      if (preference === 'spokenAudio' && state.chatStarted) {
        window.guiaHandleNarrationPreferenceChange?.(wasSpokenAudio, state.accessibilityPrefs.spokenAudio);
      }
    });
  });

  tutorialInput?.addEventListener('change', (event) => {
    state.showTutorialOnStart = event.target.checked;
    syncAccessibilityControls();
    window.saveGuiaSession?.();
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
    window.saveGuiaSession?.();
    if (state.deferredSpokenAudioChange) {
      const { wasEnabled, isEnabled } = state.deferredSpokenAudioChange;
      state.deferredSpokenAudioChange = null;
      window.guiaHandleNarrationPreferenceChange?.(wasEnabled, isEnabled);
    }
    // Always speak welcome message if audio is enabled (with delay to ensure DOM is updated)
    window.setTimeout(() => window.guiaSpeakInitialWelcome?.(), 300);
    if (state.showTutorialOnStart) {
      window.setTimeout(() => window.guiaOpenTutorial?.(), 150);
    }
  }

  bindAccessibilityPreference('opt-large-text', 'largeText');
  bindAccessibilityPreference('opt-uppercase-text', 'uppercaseText');
  bindAccessibilityPreference('opt-simple-language', 'simpleLanguage');
  bindAccessibilityPreference('opt-spoken-audio', 'spokenAudio');
  bindAccessibilityPreference('opt-more-time', 'moreTime');
  bindAccessibilityPreference('opt-visual-descriptions', 'visualDescriptions');
  el('opt-start-tutorial')?.addEventListener('change', (event) => {
    state.showTutorialOnStart = event.target.checked;
    syncAccessibilityControls();
    window.saveGuiaSession?.();
  });
  bindSettingsPanel();
  initEnterToggleCheckboxes();
  syncAccessibilityControls();

  consent?.addEventListener('change', updateOnboardingButtons);

  backBtn?.addEventListener('click', () => {
    if (state.onboardingStep > 1) showOnboardingStep(state.onboardingStep - 1);
  });

  nextBtn?.addEventListener('click', () => {
    if (state.onboardingStep < state.totalSteps) {
      if (state.privacyAccepted && state.onboardingStep === 2) {
        finishOnboarding();
        return;
      }

      showOnboardingStep(state.onboardingStep + 1);
      return;
    }

    state.privacyAccepted = true;
    window.saveGuiaSession?.();
    finishOnboarding();
  });

  showOnboardingStep(1);
}

function initOnboardingKeyboardSupport() {
  initRadioGroupKeyboard('#language-group', '[data-lang]');
  initRadioGroupKeyboard('#persona-group', '[data-persona]');
  initRadioGroupKeyboard('#age-group', '[data-age]');
}
