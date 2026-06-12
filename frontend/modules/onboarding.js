// Onboarding
function showOnboarding() {
  state.lastFocusedElement = document.activeElement;
  state.onboardingStep = 1;
  if (!state.chatStarted) {
    state.showTutorialOnStart = false;
    state.accessibilityPrefs.spokenAudio = false;
  }
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
  appShell?.setAttribute('aria-hidden', 'true');
  document.body.toggleAttribute('data-onboarding-open', true);

  showOnboardingStep(1);
  window.setTimeout(() => focusFirstAvailable(onboarding), 0);
}

function setAppShellAccessibilityEnabled(enabled, focusChatInput = false) {
  const appShell = q('.app-shell');
  if (!appShell) return;

  if (enabled) {
    appShell.removeAttribute('inert');
    appShell.removeAttribute('aria-hidden');
    if (focusChatInput) {
      requestAnimationFrame(() => el('chat-input')?.focus?.());
    }
    return;
  }

  appShell.setAttribute('inert', '');
  appShell.setAttribute('aria-hidden', 'true');
}

function hideOnboarding({ deferAppShellAccessibility = false } = {}) {
  const onboarding = el('onboarding');

  document.activeElement?.blur();

  const previous = state.lastFocusedElement;

  onboarding.setAttribute('inert', '');
  onboarding.setAttribute('aria-hidden', 'true');
  onboarding.style.display = 'none';
  setAppShellAccessibilityEnabled(!deferAppShellAccessibility);
  document.body.removeAttribute('data-onboarding-open');

  if (!deferAppShellAccessibility) {
    requestAnimationFrame(() => {
      previous?.focus?.();
    });
  }
  
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
    tutorialInput: el('settings-start-tutorial'),
    tutorialSpokenInput: el('settings-tutorial-spoken')
  };
}

let pendingSettingsLang = null;

function selectedSettingsLang() {
  return pendingSettingsLang || state.selectedLang;
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
  pendingSettingsLang = null;
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

  // Move focus back to the last focused element before hiding the modal
  requestAnimationFrame(() => state.lastFocusedElement?.focus?.());
  pendingSettingsLang = null;

  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('hidden', '');
  modal.hidden = true;
  document.body.removeAttribute('data-settings-open');
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
  setText(el('label-personality-intro'), t('onboarding.personalityIntro'));
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

  // Translate accessibility category headers
  qa('.accessibility-category').forEach((el) => {
    const key = el.dataset.i18nKey;
    if (key) {
      const translation = t(key);
      if (translation) {
        el.textContent = translation;
      }
    }
  });

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

  const optAudioDescriptionLabel = q('#opt-visual-descriptions')?.closest('label')?.querySelector('.toggle-content > span');
  setText(optAudioDescriptionLabel, t('onboarding.audioDescription'));
  const optAudioDescriptionHelp = q('#opt-visual-descriptions')?.closest('label')?.querySelector('.card-subtitle');
  setText(optAudioDescriptionHelp, t('onboarding.audioDescriptionHelp'));

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
  setText(privacyParagraphs[5], t('onboarding.privacyIntro6'));

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
    audioDescription: ['onboarding.audioDescription', 'onboarding.audioDescriptionHelp']
  };

  Object.entries(preferenceLabels).forEach(([preference, keys]) => {
    setText(q(`[data-settings-label="${preference}"]`), t(keys[0]));
    setText(q(`[data-settings-help="${preference}"]`), t(keys[1]));
  });

  setText(el('settings-start-tutorial-label'), t('onboarding.startTutorial'));
  setText(el('settings-start-tutorial-help'), t('onboarding.startTutorialHelp'));
  setText(el('settings-tutorial-spoken-label'), t('onboarding.tutorialSpoken'));
  setText(el('settings-tutorial-spoken-help'), t('onboarding.tutorialSpokenHelp'));
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

  const tutorialSpokenInput = el('settings-tutorial-spoken');
  if (tutorialSpokenInput) {
    tutorialSpokenInput.setAttribute('aria-labelledby', 'settings-tutorial-spoken-label');
    tutorialSpokenInput.setAttribute('aria-describedby', 'settings-tutorial-spoken-help');
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

  updateOnboardingButtons();

  // Focus the step-count element in the header to trigger aria-live announcement
  window.setTimeout(() => {
    const stepCount = el('step-count');
    if (!stepCount) return;

    if (step === 1) {
      stepCount.setAttribute('aria-describedby', 'label-personality-intro');
    } else {
      stepCount.removeAttribute('aria-describedby');
    }

    stepCount.focus();
  }, 50);

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

function syncChatLiveRegionWithNarration() {
  const chatPanel = q('.chat-panel');
  if (!chatPanel) return;

  chatPanel.setAttribute('aria-live', state.accessibilityPrefs.spokenAudio ? 'off' : 'polite');
}

window.guiaSuppressAppShellForWelcome = () => setAppShellAccessibilityEnabled(false);
window.guiaRevealAppShellAfterWelcome = () => setAppShellAccessibilityEnabled(true, true);

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
  document.body.toggleAttribute('data-visual-descriptions', state.accessibilityPrefs.audioDescription);

  syncChatLiveRegionWithNarration();

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
    'opt-visual-descriptions': 'audioDescription'
  };

  Object.entries(preferences).forEach(([id, preference]) => {
    const input = el(id);
    if (input) input.checked = !!state.accessibilityPrefs[preference];
  });

  // Tutorials (mutually exclusive)
  const tutorialInput = el('opt-start-tutorial');
  if (tutorialInput) {
    tutorialInput.checked = !!state.showTutorialOnStart;
    const tutorialLabel = tutorialInput.parentElement.querySelector('.toggle-content span');
    if (tutorialLabel) {
      setText(tutorialLabel, t('onboarding.tutorial', 'Visual tutorial'));
    }
    const tutorialHelp = el('opt-start-tutorial-help');
    if (tutorialHelp) {
      setText(tutorialHelp, t('onboarding.startTutorialHelp', 'GuIA explains the main buttons visually before the visit starts.'));
    }
  }

  const tutorialSpokenInput = el('opt-tutorial-spoken');
  if (tutorialSpokenInput) {
    tutorialSpokenInput.checked = !!state.accessibilityPrefs.tutorialSpoken;
    tutorialSpokenInput.setAttribute('aria-label', t('onboarding.tutorialSpoken', 'Screen reader compatible tutorial and with voice option'));
    const tutorialSpokenLabel = tutorialSpokenInput.parentElement.querySelector('.toggle-content span');
    if (tutorialSpokenLabel) {
      setText(tutorialSpokenLabel, t('onboarding.tutorialSpoken', 'Screen reader compatible tutorial and with voice option'));
    }
    const tutorialSpokenHelp = el('opt-tutorial-spoken-help');
    if (tutorialSpokenHelp) {
      setText(tutorialSpokenHelp, t('onboarding.tutorialSpokenHelp', 'GuIA describes in audio the main buttons before the visit starts.'));
    }
  }

  syncSettingsControls();
}


function syncSettingsControls() {
  const settingsLang = selectedSettingsLang();
  qa('[data-settings-lang]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.settingsLang === settingsLang ? 'true' : 'false');
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

  const tutorialSpokenInput = el('settings-tutorial-spoken');
  if (tutorialSpokenInput) tutorialSpokenInput.checked = !!state.accessibilityPrefs.tutorialSpoken;
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
    const previous = state.accessibilityPrefs[preference];

    state.accessibilityPrefs[preference] = event.target.checked;
    window.guiaTrack?.('option_changed', {
      field: `pref:${preference}`,
      from: previous,
      to: event.target.checked,
      where: 'onboarding'
    });

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
  doneBtn?.addEventListener('click', async () => {
    if (pendingSettingsLang && pendingSettingsLang !== state.selectedLang) {
      if (state.chatGenerating || state.conversationTranslating) {
        announce(t('chat.languageChangeBusy', 'Wait until the current response or translation finishes before changing language.'));
        return;
      }

      const previousLang = state.selectedLang;
      state.selectedLang = pendingSettingsLang;
      pendingSettingsLang = null;
      window.guiaTrack?.('option_changed', { field: 'lang', from: previousLang, to: state.selectedLang, where: 'settings' });
      selectRadio(qa('#language-group [data-lang]'), q(`#language-group [data-lang="${state.selectedLang}"]`));
      syncSettingsControls();
      doneBtn.disabled = true;
      try {
        await applyLanguageChange(previousLang);
        applySettingsTranslations();
        window.saveGuiaSession?.();
      } finally {
        doneBtn.disabled = false;
      }
    }

    // Check if tutorial should be opened
    if (state.showTutorialOnStart) {
      hideSettingsPanel();
      window.setTimeout(() => window.guiaOpenTutorial?.(), 150);
    } else if (state.accessibilityPrefs.tutorialSpoken) {
      hideSettingsPanel();
      window.setTimeout(() => window.guiaOpenSpokenTutorial?.(0), 150);
    } else {
      hideSettingsPanel();
    }
  });
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
    btn.addEventListener('click', () => {
      if (selectedSettingsLang() === btn.dataset.settingsLang) return;
      if (state.chatGenerating || state.conversationTranslating) {
        announce(t('chat.languageChangeBusy', 'Wait until the current response or translation finishes before changing language.'));
        return;
      }
      pendingSettingsLang = btn.dataset.settingsLang === state.selectedLang ? null : btn.dataset.settingsLang;
      syncSettingsControls();
    });
  });

  qa('[data-settings-persona]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const previous = state.selectedPersona;
      state.selectedPersona = btn.dataset.settingsPersona;
      window.guiaTrack?.('option_changed', { field: 'persona', from: previous, to: state.selectedPersona, where: 'settings' });
      selectRadio(qa('[data-persona]'), q(`[data-persona="${state.selectedPersona}"]`));
      syncSettingsControls();
      updateOnboardingButtons();
      window.saveGuiaSession?.();
    });
  });

  qa('[data-settings-age]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const previous = state.selectedAge;
      state.selectedAge = state.selectedAge === btn.dataset.settingsAge ? null : btn.dataset.settingsAge;
      window.guiaTrack?.('option_changed', { field: 'age', from: previous, to: state.selectedAge, where: 'settings' });
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
      const previous = state.accessibilityPrefs[preference];
      state.accessibilityPrefs[preference] = event.target.checked;
      window.guiaTrack?.('option_changed', { field: `pref:${preference}`, from: previous, to: event.target.checked, where: 'settings' });
      syncAccessibilityControls();
      applyAccessibilityPrefs();
      window.saveGuiaSession?.();

      if (preference === 'spokenAudio' && state.chatStarted) {
        window.guiaHandleNarrationPreferenceChange?.(wasSpokenAudio, state.accessibilityPrefs.spokenAudio);
      }
    });
  });

  const tutorialSpokenInput = el('opt-tutorial-spoken');

  tutorialInput?.addEventListener('change', (event) => {
    // Visual tutorial
    state.showTutorialOnStart = event.target.checked;
    if (event.target.checked) {
      // Ensure the spoken tutorial cannot be enabled at the same time.
      state.accessibilityPrefs.tutorialSpoken = false;
      // Keep the toggle and open condition consistent.
      state.showTutorialOnStart = true;
    }
    syncAccessibilityControls();
    applyAccessibilityPrefs();
    window.saveGuiaSession?.();
  });

  tutorialSpokenInput?.addEventListener('change', (event) => {
    // Spoken tutorial
    state.accessibilityPrefs.tutorialSpoken = event.target.checked;
    if (event.target.checked) {
      state.showTutorialOnStart = false;
    }
    syncAccessibilityControls();
    applyAccessibilityPrefs();
    window.saveGuiaSession?.();
  });

  // Settings panel tutorial checkboxes (mutually exclusive)
  const settingsTutorialInput = el('settings-start-tutorial');
  const settingsTutorialSpokenInput = el('settings-tutorial-spoken');

  settingsTutorialInput?.addEventListener('change', (event) => {
    // Visual tutorial in settings
    state.showTutorialOnStart = event.target.checked;
    if (event.target.checked) {
      // Ensure the spoken tutorial cannot be enabled at the same time.
      state.accessibilityPrefs.tutorialSpoken = false;
    }
    syncSettingsControls();
    syncAccessibilityControls();
    window.saveGuiaSession?.();
  });

  settingsTutorialSpokenInput?.addEventListener('change', (event) => {
    // Spoken tutorial in settings
    state.accessibilityPrefs.tutorialSpoken = event.target.checked;
    if (event.target.checked) {
      state.showTutorialOnStart = false;
    }
    syncSettingsControls();
    syncAccessibilityControls();
    window.saveGuiaSession?.();
  });

}

function bindOnboardingFlow() {
  const { backBtn, nextBtn, consent } = onboardingEls();

  function finishOnboarding() {
    state.chatStarted = true;
    if (state.accessibilityPrefs.audioDescription) {
      state.accessibilityPrefs.spokenAudio = true;
    }
    window.guiaTrack?.('onboarding_completed', {
      lang: state.selectedLang,
      persona: state.selectedPersona,
      age: state.selectedAge,
      prefs: { ...state.accessibilityPrefs }
    });
    applyAppTranslations();
    applyAccessibilityPrefs();
    syncAccessibilityControls();
    // Ensure audio is muted when spokenAudio is disabled
    window.guiaUpdateSpokenAudio?.();
    const startsTutorial = state.showTutorialOnStart;
    const deferAppShellAccessibility = false;
    hideOnboarding({ deferAppShellAccessibility });
    // Reopen location panel after onboarding
    document.body.toggleAttribute('data-location-panel-open', true);
    el('location-panel-btn')?.setAttribute('aria-expanded', 'true');
    window.saveGuiaSession?.();
    if (state.deferredSpokenAudioChange) {
      const { wasEnabled, isEnabled } = state.deferredSpokenAudioChange;
      state.deferredSpokenAudioChange = null;
      window.guiaHandleNarrationPreferenceChange?.(wasEnabled, isEnabled);
    }
    // Open selected tutorial (visual or spoken) after onboarding closes.
    // Use the real UI checkbox states to avoid inconsistencies from a previously persisted session.
    const wantsVisualTutorial = !!state.showTutorialOnStart;
    const wantsSpokenTutorial = !!state.accessibilityPrefs.tutorialSpoken;

    const shouldShowSpokenTutorial = wantsSpokenTutorial;
    const shouldShowVisualTutorial =
      wantsVisualTutorial && !shouldShowSpokenTutorial;
    // Ensure visual tutorial opens even if the body attribute isn't fully set yet.
    if (shouldShowSpokenTutorial) {
      window.setTimeout(() => window.guiaOpenSpokenTutorial?.(0), 150);
      return;
    }

    if (shouldShowVisualTutorial) {
      window.setTimeout(() => {
        window.guiaOpenTutorial?.();
      }, 150);
      return;
    }


    window.setTimeout(() => window.guiaSpeakInitialWelcome?.(), 300);

  }

  bindAccessibilityPreference('opt-large-text', 'largeText');
  bindAccessibilityPreference('opt-uppercase-text', 'uppercaseText');
  bindAccessibilityPreference('opt-simple-language', 'simpleLanguage');
  bindAccessibilityPreference('opt-spoken-audio', 'spokenAudio');
  bindAccessibilityPreference('opt-more-time', 'moreTime');
  bindAccessibilityPreference('opt-visual-descriptions', 'audioDescription');

  // Tutorials (mutually exclusive)
  el('opt-start-tutorial')?.addEventListener('change', (event) => {
    // Visual tutorial
    state.showTutorialOnStart = event.target.checked;
    if (event.target.checked) {
      state.accessibilityPrefs.tutorialSpoken = false;
    }
    syncAccessibilityControls();
    applyAccessibilityPrefs();
    window.saveGuiaSession?.();
  });

  el('opt-tutorial-spoken')?.addEventListener('change', (event) => {
    // Spoken tutorial
    state.accessibilityPrefs.tutorialSpoken = event.target.checked;
    if (event.target.checked) {
      state.showTutorialOnStart = true;
    }
    syncAccessibilityControls();
    applyAccessibilityPrefs();
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
