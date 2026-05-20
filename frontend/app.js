// State
const state = {
  selectedPersona: null,
  selectedAge: null,
  selectedLang: null,
  currentRoom: null,
  currentArtwork: null,

  translations: {},
  locationData: { rooms: [] },

  onboardingStep: 1,
  totalSteps: 3,
  lastFocusedElement: null,
  privacyAccepted: false,
  chatStarted: false,

  accessibilityPrefs: {
    largeText: false,
    simpleLanguage: false,
    spokenAudio: false,
    moreTime: false,
    visualDescriptions: false

  }
};

const sessionId = crypto.randomUUID();


const API_BASES = (() => {
  const isLocalSplitServer =
    ['127.0.0.1', 'localhost'].includes(window.location.hostname) &&
    window.location.port === '8000';

  return {
    llm: isLocalSplitServer ? 'http://127.0.0.1:5002' : '',
    audio: isLocalSplitServer ? 'http://127.0.0.1:5000' : ''
  };
})();

const API_ENDPOINTS = {
  chatStream: `${API_BASES.llm}/chat/stream`,
  context: `${API_BASES.llm}/context`,
  easyWords: `${API_BASES.llm}/easy-words`,
  locations: `${API_BASES.llm}/locations`,
  speak: `${API_BASES.audio}/speak`,
  transcribe: `${API_BASES.audio}/transcribe`,
  translations: 'translations.json'
};

const PERSONA_KEYS = ['artist', 'storyteller', 'explorer', 'scholar'];
const AGE_KEYS = ['young', 'adult', 'senior'];
const AUDIO_SPEED_KEYS = ['slow', 'normal', 'fast'];
const DEFAULT_LANGUAGE = 'ca';

const SPEECH_SPEED = {
  slow: 0.8,
  normal: 1,
  fast: 1.5
};

const BROWSER_SPEECH_LANG = {
  en: 'en-US',
  es: 'es-ES',
  ca: 'ca-ES'
};

const BROWSER_SPEECH_PERSONA = {
  child: { pitch: 1.6, rate: 1.05 },
  teen: { pitch: 1.2, rate: 1.0 },
  adult: { pitch: 1.0, rate: 0.95 },
  senior: { pitch: 0.9, rate: 0.9 }
};

const VOICE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4'
];

window.USE_KOKORO = true;

// DOM helpers
const dom = {
  byId: new Map(),

  id(id) {
    if (!this.byId.has(id)) {
      this.byId.set(id, document.getElementById(id));
    }
    return this.byId.get(id);
  },

  q(selector, root = document) {
    return root.querySelector(selector);
  },

  qa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  },

  clearCache() {
    this.byId.clear();
  }
};

function el(id) {
  return dom.id(id);
}

function q(selector, root = document) {
  return dom.q(selector, root);
}

function qa(selector, root = document) {
  return dom.qa(selector, root);
}

function setText(node, text) {
  if (node) node.textContent = text;
}

function setAttribute(node, name, value) {
  if (node) node.setAttribute(name, value);
}

function announce(message) {
  const status = el('sr-status');
  if (!status || !message) return;
  status.textContent = '';
  window.setTimeout(() => {
    status.textContent = message;
  }, 20);
}

function focusFirstAvailable(root) {
  const target = q(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root
  );
  target?.focus?.();
}

// i18n
function getNestedTranslation(source, key) {
  return key.split('.').reduce((obj, k) => (obj ? obj[k] : undefined), source);
}

let translationsLoaded = false;

function t(key, fallback) {
  const currentLang = state.translations[state.selectedLang];
  const caLang = state.translations['ca'];

  return (
    getNestedTranslation(currentLang, key) ??
    getNestedTranslation(caLang, key) ??
    fallback ??
    key
  );
}

async function preloadTranslations() {
  if (translationsLoaded) return;

  try {
    const res = await fetch(API_ENDPOINTS.translations);
    if (!res.ok) throw new Error('translations.json fetch failed');
    state.translations = await res.json();
    translationsLoaded = true;
  } catch (e) {
    console.error('translations.json not found - serving without i18n', e);
    state.translations = {};
    translationsLoaded = false;
  }
}

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
      window.guiaHandleNarrationPreferenceChange?.(wasSpokenAudio, state.accessibilityPrefs.spokenAudio);
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
      if (state.privacyAccepted && state.onboardingStep === 2) {
        finishOnboarding();
        return;
      }

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

// App translations

function applyAppTranslations() {
  if (!state.translations[state.selectedLang]) return;
  document.documentElement.lang = state.selectedLang || 'ca';

  qa('.speed-btn').forEach((btn, i) => {
    btn.textContent = t(`audio.${AUDIO_SPEED_KEYS[i]}`);
  });

  setText(q('.audio-label'), t('audio.volume', 'Volume'));

  const spokenAudioBtn = el('spoken-audio-btn');
  if (spokenAudioBtn) {
    const enabled = spokenAudioBtn.getAttribute('aria-pressed') === 'true';
    spokenAudioBtn.textContent = enabled
      ? t('audio.spokenOn', 'Audio on')
      : t('audio.spokenOff', 'Audio off');
    spokenAudioBtn.setAttribute(
      'aria-label',
      enabled ? t('audio.turnSpokenOff', 'Turn spoken audio off') : t('audio.turnSpokenOn', 'Turn spoken audio on')
    );
  }

  const playbackBtn = el('audio-playback-btn');
  if (playbackBtn) {
    const paused = playbackBtn.getAttribute('aria-pressed') === 'true';
    playbackBtn.setAttribute('aria-label', paused ? t('audio.resume', 'Resume audio') : t('audio.pause', 'Pause audio'));
  }

  setAttribute(el('audio-replay-btn'), 'aria-label', t('audio.replay', 'Replay last answer'));

  const firstAssistantBubble = q('.assistant-bubble');
  setText(firstAssistantBubble, t('chat.welcome'));
  updateBubbleAccessibilityLabel(firstAssistantBubble, 'assistant');

  const suggestions = t('chat.suggestions');
  qa('.suggestion-btn').forEach((btn, i) => {
    if (suggestions[i]) btn.textContent = suggestions[i];
  });

  setText(q('.brand-title'), t('app.title'));

  const appTitle = el('app-title');
  if (appTitle) {
    appTitle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">settings</span>';
    appTitle.setAttribute('aria-label', t('app.openSettings', 'Open guide settings'));
  }

  setText(el('choose-location'), t('app.chooseLocation'));
  setText(el('location-panel-text'), t('app.locationButton', 'Location'));
  setAttribute(el('location-panel-btn'), 'aria-label', t('app.chooseLocation', 'Choose your location'));
  setText(el('room'), t('app.room'));
  setText(el('artwork'), t('app.artwork'));
  setText(el('room-help'), t('app.roomHelp', 'Select the room where you are now.'));
  setText(el('artwork-help'), t('app.artworkHelp', 'Optionally select the artwork in front of you.'));
  setText(el('qr-scanner-help'), t('app.qrScannerHelp', 'The camera is active to scan a location QR code.'));
  setText(el('set-context-btn'), t('app.confirmLocation', 'Confirm location'));

  // NaviLens and QR scanner button labels
  const openNaviLensText = el('open-navilens-text');
  if (openNaviLensText) openNaviLensText.textContent = t('app.openNaviLens');
  setAttribute(el('open-app-btn'), 'aria-label', t('app.openNaviLens', 'Open NaviLens'));
  const scanQRText = el('scan-qr-text');
  if (scanQRText) scanQRText.textContent = t('app.scanQRCode');
  setAttribute(el('scan-qr-btn'), 'aria-label', t('app.scanQRCode', 'Scan QR Code'));
  const manualLocationText = el('manual-location-text');
  if (manualLocationText) manualLocationText.textContent = t('app.chooseManually', 'Choose manually');
  setAttribute(el('manual-location-btn'), 'aria-label', t('app.chooseManually', 'Choose manually'));
  const closeScannerText = el('close-scanner-text');
  if (closeScannerText) closeScannerText.textContent = t('app.closeScanner');
  setAttribute(el('close-qr-btn'), 'aria-label', t('app.closeScanner', 'Close scanner'));
  const confirmLocationText = el('confirm-location-text');
  if (confirmLocationText) confirmLocationText.textContent = t('app.confirmLocation');

  // Opciones del select de sala
  renderLocationSelects();
  renderContextSuggestion();

  setText(el('confirm-suggestion-btn'), t('app.confirmSuggestion'));

  setText(q('.helper-text'), t('chat.helper'));
  const chatInputEl = el('chat-input');
  if (chatInputEl) chatInputEl.placeholder = t('chat.placeholder');
  setText(el('send-btn'), t('chat.send'));
  window.guiaSetLastAssistantText?.(t('chat.welcome'));
}

async function applyLanguageChange() {
  if (state.selectedLang !== 'ca' || !translationsLoaded) {
    await preloadTranslations();
  }

  applyOnboardingTranslations();
  applyAppTranslations();
  updateOnboardingButtons();
  window.guiaResetSpeechQueue?.();
}

// General helpers

function selectRadio(buttons, clicked) {
  buttons.forEach((b) => {
    const selected = b === clicked;
    b.setAttribute('aria-checked', selected ? 'true' : 'false');
    b.setAttribute('tabindex', '0');
  });
}

function initEnterToggleCheckboxes() {
  qa('.toggle-row input[type="checkbox"]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.click();
    });
  });
}

function enableSelectEnterOpen(select) {
  select?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    if (typeof select.showPicker === 'function') {
      event.preventDefault();
      try {
        select.showPicker();
      } catch (err) {
        select.click();
      }
      return;
    }

    select.click();
  });
}

function initRadioGroupKeyboard(groupSelector, buttonSelector) {
  const group = q(groupSelector);
  if (!group) return;

  group.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const buttons = qa(buttonSelector, group).filter((button) => !button.disabled);
    if (!buttons.length) return;

    event.preventDefault();

    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1;
    }

    buttons[nextIndex].focus();
    buttons[nextIndex].click();
  });
}

function addBubble(role, text) {
  const chatThread = el('chat-thread');
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${role === 'user' ? 'user-bubble' : 'assistant-bubble'}`;
  bubble.textContent = text;
  updateBubbleAccessibilityLabel(bubble, role);
  row.appendChild(bubble);
  chatThread.appendChild(row);
  chatThread.scrollTop = chatThread.scrollHeight;
  return bubble;
}

function updateBubbleAccessibilityLabel(bubble, role) {
  if (!bubble) return;
  const label =
    role === 'user'
      ? t('chat.userMessageLabel', 'You')
      : t('chat.assistantMessageLabel', 'GuIA');
  bubble.setAttribute('aria-label', `${label}: ${bubble.textContent.trim()}`);
}

function easyWordAnnotationsEnabled() {
  return state.accessibilityPrefs.simpleLanguage;
}

async function annotateEasyWords(bubble) {
  if (!bubble || !easyWordAnnotationsEnabled()) return;

  const text = bubble.textContent.trim();
  if (!text) return;

  try {
    const res = await fetch(API_ENDPOINTS.easyWords, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: state.selectedLang })
    });

    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.rewritten_text === 'string' && data.rewritten_text.trim()) {
      bubble.textContent = data.rewritten_text.trim();
      updateBubbleAccessibilityLabel(bubble, 'assistant');
      return;
    }

    const annotations = Array.isArray(data.annotations) ? data.annotations : [];
    if (!annotations.length) return;

    renderAnnotatedText(bubble, text, annotations);
  } catch (err) {
    console.warn('Could not annotate easy words:', err);
  }
}

function renderAnnotatedText(container, text, annotations) {
  const byWord = new Map();
  annotations.forEach((item) => {
    const word = (item.word || '').trim().toLowerCase();
    if (!word || byWord.has(word)) return;
    byWord.set(word, item);
  });

  if (!byWord.size) return;

  const pattern = new RegExp(`\\b(${[...byWord.keys()].map(escapeRegExp).join('|')})\\b`, 'giu');
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const item = byWord.get(match[0].toLowerCase());
    const span = document.createElement('span');
    span.className = 'easy-word';
    span.textContent = item.replacement || match[0];
    const label = item.replacement ? `${match[0]}: ${item.definition}` : item.definition;
    span.title = label;
    span.setAttribute('aria-label', label);
    fragment.appendChild(span);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  container.textContent = '';
  container.appendChild(fragment);
  updateBubbleAccessibilityLabel(container, 'assistant');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Locations / context

async function loadLocations() {
  try {
    const res = await fetch(API_ENDPOINTS.locations);
    if (!res.ok) throw new Error(await res.text());
    state.locationData = await res.json();
  } catch (e) {
    console.warn('Could not load museum locations from backend:', e);
    state.locationData = { rooms: [] };
  }
}

function renderLocationSelects() {
  const roomSelect = el('room-select');
  if (!roomSelect) return;

  const selectedRoom = roomSelect.value;
  roomSelect.innerHTML = '';
  roomSelect.appendChild(new Option(t('context.selectRoom', 'Select a room'), ''));

  (state.locationData.rooms || []).forEach((room) => {
    roomSelect.appendChild(new Option(room.label || room.id, room.id));
  });

  if ((state.locationData.rooms || []).some((room) => room.id === selectedRoom)) {
    roomSelect.value = selectedRoom;
  }

  renderArtworkSelect();
  renderContextSuggestion();
}

function renderArtworkSelect() {
  const roomSelect = el('room-select');
  const artworkSelect = el('artwork-select');
  if (!roomSelect || !artworkSelect) return;

  const selectedArtwork = artworkSelect.value;
  const selectedRoom = (state.locationData.rooms || []).find((room) => room.id === roomSelect.value);

  artworkSelect.innerHTML = '';
  artworkSelect.appendChild(new Option(t('context.selectArtwork', 'Select an artwork'), ''));
  artworkSelect.disabled = !selectedRoom;

  if (!selectedRoom) return;

  (selectedRoom.artworks || []).forEach((artwork) => {
    artworkSelect.appendChild(new Option(artwork.title, artwork.id || artwork.title));
  });

  if ((selectedRoom.artworks || []).some((artwork) => (artwork.id || artwork.title) === selectedArtwork)) {
    artworkSelect.value = selectedArtwork;
  }
}

function renderContextSuggestion() {
  const suggestion = q('.context-suggestion');
  if (!suggestion) return;

  const firstRoom = (state.locationData.rooms || [])[0];
  const firstArtwork = firstRoom?.artworks?.[0];
  const textNode = Array.from(suggestion.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);

  if (!firstRoom || !textNode) return;

  const roomLabel = firstRoom.label || firstRoom.id;
  const artworkLabel = firstArtwork?.title;
  const prefix = CONTEXT_SUGGESTION_PREFIX[state.selectedLang];
  textNode.textContent = artworkLabel
    ? `${prefix} ${roomLabel}, ${artworkLabel}? `
    : `${prefix} ${roomLabel}? `;
}

// Boot

async function loadTranslations() {
  const translationsPromise = preloadTranslations();
  const locationsPromise = loadLocations();

  state.selectedLang = DEFAULT_LANGUAGE;
  selectRadio(qa('#language-group [data-lang]'), q(`#language-group [data-lang="${state.selectedLang}"]`));

  initLanguageSelector();
  initPersonaButtons();
  initAgeButtons();
  initOnboardingFocusTrap();
  initOnboardingKeyboardSupport();

  bindOnboardingFlow();

  initAppTitleButton();
  initApp();
  applyAppTranslations();

  if (state.selectedLang !== 'ca') {
    await translationsPromise;
    applyOnboardingTranslations();
    applyAppTranslations();
  } else {
    translationsPromise.then(() => {
      applyOnboardingTranslations();
      applyAppTranslations();
    });
  }

  window.addEventListener('resize', () => {
    if (state.selectedLang !== 'ca' || translationsLoaded) {
      applyAppTranslations();
    }
  });

  await locationsPromise;
}

document.addEventListener('DOMContentLoaded', loadTranslations);

// Small initializers

function initLanguageSelector() {
  const btns = qa('#language-group [data-lang]');

  btns.forEach((b) =>
    b.setAttribute('aria-checked', b.dataset.lang === state.selectedLang ? 'true' : 'false')
  );
  btns.forEach((b) => b.setAttribute('tabindex', '0'));

  btns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.selectedLang === btn.dataset.lang) return;
      state.selectedLang = btn.dataset.lang;
      selectRadio(btns, btn);
      await applyLanguageChange();
    });
  });
}

function initPersonaButtons() {
  const btns = qa('[data-persona]');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedPersona = btn.dataset.persona;
      selectRadio(btns, btn);
      updateOnboardingButtons();
    });
  });
}

function initAgeButtons() {
  const btns = qa('[data-age]');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.selectedAge === btn.dataset.age) {
        state.selectedAge = null;
        btn.setAttribute('aria-checked', 'false');
      } else {
        state.selectedAge = btn.dataset.age;
        selectRadio(btns, btn);
      }
      updateOnboardingButtons();
    });
  });
}

// Main app

function initApp() {
  const audio = initAudioControls();
  const voice = initVoiceInput(audio);

  initInitialWelcomeSpeech(audio);
  initContextPanel();
  initChat(audio, voice);

  el('app-title')?.addEventListener('click', () => {
    showOnboarding();
  });
}

// Audio controls

function initAudioControls() {
  const speedBtns = qa('.speed-btn');
  const muteBtn = el('mute-btn');
  const volumeSlider = el('volume-slider');
  const playbackBtn = el('audio-playback-btn');
  const replayBtn = el('audio-replay-btn');
  const spokenAudioBtn = el('spoken-audio-btn');
  const audioSettingsBtn = el('audio-settings-btn');

  let isMuted = false;
  let isAudioPaused = false;
  let spokenAudioEnabled = false;
  let currentVolume = 0.5;
  let previousVolume = 0.5;
  let audioWaiters = [];
  let currentAudioBaseSpeed = 'normal';
  let currentSpeechSpeed = 'normal';
  let speechPlaybackQueue = Promise.resolve();
  let speechQueueVersion = 0;
  let currentAudio = null;
  let lastAssistantText = '';

  function setAudioSettingsOpen(open) {
    document.body.toggleAttribute('data-audio-settings-open', open);
    if (!audioSettingsBtn) return;

    audioSettingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const icon = q('.material-symbols-outlined', audioSettingsBtn);
    if (icon) icon.textContent = open ? 'close' : 'tune';
    audioSettingsBtn.setAttribute(
      'aria-label',
      open
        ? t('audio.closeSettings', 'Close audio settings')
        : t('audio.openSettings', 'Open audio settings')
    );
  }

  function updateMuteIcon() {
    if (!muteBtn) return;
    const muted = isMuted || !spokenAudioEnabled || currentVolume === 0;
    muteBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${muted ? 'volume_off' : 'volume_up'}</span>`;
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', muted ? t('audio.unmute', 'Unmute audio') : t('audio.mute', 'Mute audio'));
  }

  function updatePlaybackButton() {
    if (!playbackBtn) return;

    const icon = q('.material-symbols-outlined', playbackBtn);
    if (icon) icon.textContent = isAudioPaused ? 'play_arrow' : 'pause';
    playbackBtn.setAttribute('aria-pressed', isAudioPaused ? 'true' : 'false');
    playbackBtn.setAttribute(
      'aria-label',
      isAudioPaused ? t('audio.resume', 'Resume audio') : t('audio.pause', 'Pause audio')
    );
  }

  function updateSpokenAudioButton() {
    spokenAudioEnabled = !!state.accessibilityPrefs.spokenAudio;
    isMuted = !spokenAudioEnabled;

    if (spokenAudioEnabled && volumeSlider && Number(volumeSlider.value) === 0) {
      volumeSlider.value = Math.round((previousVolume || 0.5) * 100);
      currentVolume = Number(volumeSlider.value) / 100;
    }

    applyAudioSettings();
    updateMuteIcon();

    if (spokenAudioEnabled) {
      resumeAudioOutput();
    } else {
      pauseAudioOutput();
    }

    if (!spokenAudioBtn) return;

    spokenAudioBtn.textContent = spokenAudioEnabled
      ? t('audio.spokenOn', 'Audio on')
      : t('audio.spokenOff', 'Audio off');
    spokenAudioBtn.setAttribute('aria-pressed', spokenAudioEnabled ? 'true' : 'false');
    spokenAudioBtn.setAttribute(
      'aria-label',
      spokenAudioEnabled
        ? t('audio.turnSpokenOff', 'Turn spoken audio off')
        : t('audio.turnSpokenOn', 'Turn spoken audio on')
    );
  }

  function applyAudioSettings(audio = currentAudio) {
    if (!audio) return;
    audio.volume = isMuted || !spokenAudioEnabled ? 0 : currentVolume;
    audio.muted = isMuted || !spokenAudioEnabled || currentVolume === 0;
    const baseRate = SPEECH_SPEED[currentAudioBaseSpeed];
    const targetRate = SPEECH_SPEED[currentSpeechSpeed];
    audio.playbackRate = targetRate / baseRate;
  }

  function canPlayAudio() {
    return spokenAudioEnabled && !isAudioPaused;
  }

  function waitUntilAudioAllowed() {
    if (canPlayAudio()) return Promise.resolve();
    return new Promise((resolve) => {
      audioWaiters.push(resolve);
    });
  }

  function resolveAudioWaiters() {
    const waiters = audioWaiters;
    audioWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function releaseAudioWaiters() {
    if (!canPlayAudio()) return;
    resolveAudioWaiters();
  }

  function pauseAudioOutput() {
    if (currentAudio && !currentAudio.paused) {
      applyAudioSettings(currentAudio);
      currentAudio.pause();
    }

    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
    }
  }

  function resumeAudioOutput() {
    if (!canPlayAudio()) return;

    if (currentAudio && currentAudio.paused) {
      applyAudioSettings(currentAudio);
      currentAudio.play().catch((err) => {
        console.error('Audio resume failed:', err);
      });
    }

    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }

    releaseAudioWaiters();
  }

  function stopCurrentAudio() {
    if (!currentAudio) return;

    const audio = currentAudio;
    currentAudio = null;
    audio.pause();
    audio.currentTime = 0;
    if (typeof audio.onended === 'function') {
      audio.onended();
    }
  }

  function resetSpeechQueue() {
    speechQueueVersion += 1;
    speechPlaybackQueue = Promise.resolve();

    stopCurrentAudio();
    speechSynthesis.cancel();
    resolveAudioWaiters();
  }

  function setSpeechSpeed(speed) {
    currentSpeechSpeed = speed;
    applyAudioSettings();

    speedBtns.forEach((btn) => {
      const on = btn.dataset.speed === speed;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  async function fetchKokoroAudio(text, lang = state.selectedLang) {
    const res = await fetch(API_ENDPOINTS.speak, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang, speed: currentSpeechSpeed })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return res.blob();
  }

  function playAudioBlob(blob, generatedSpeed = currentSpeechSpeed) {
    return new Promise(async (resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      currentAudioBaseSpeed = generatedSpeed;
      applyAudioSettings(audio);

      const cleanup = (played = true) => {
        if (currentAudio === audio) {
          currentAudio = null;
        }
        URL.revokeObjectURL(url);
        resolve(played);
      };

      audio.onended = () => cleanup(true);
      audio.onerror = () => cleanup(false);

      try {
        await waitUntilAudioAllowed();

        if (currentAudio !== audio) {
          cleanup(false);
          return;
        }

        await audio.play();
      } catch (err) {
        console.error('Audio playback failed:', err);
        cleanup(false);
      }
    });
  }

  function speakBrowser(text, lang = state.selectedLang, persona = 'adult', cancelExisting = true) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);

      utterance.lang = BROWSER_SPEECH_LANG[lang];

      const style = BROWSER_SPEECH_PERSONA[persona];
      utterance.pitch = style.pitch;
      utterance.volume = isMuted || !spokenAudioEnabled ? 0 : currentVolume;

      utterance.rate = style.rate * (SPEECH_SPEED[currentSpeechSpeed]);
      utterance.onend = resolve;
      utterance.onerror = resolve;

      if (cancelExisting) speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
  }

  function queueSpeech(text, lang = state.selectedLang, persona = state.selectedPersona) {
    if (!spokenAudioEnabled) return;

    const sentence = text.trim();
    if (!sentence) return;

    const queueVersion = speechQueueVersion;

    if (window.USE_KOKORO) {
      const requestedSpeed = currentSpeechSpeed;
      const audioPromise = fetchKokoroAudio(sentence, lang)
        .then((blob) => ({ blob }))
        .catch((err) => ({ err }));

      speechPlaybackQueue = speechPlaybackQueue
        .catch(() => {})
        .then(async () => {
          if (queueVersion !== speechQueueVersion) return;

          await waitUntilAudioAllowed();

          if (queueVersion !== speechQueueVersion) return;

          try {
            const result = await audioPromise;

            if (queueVersion !== speechQueueVersion) return;
            if (result.err) throw result.err;

            const played = await playAudioBlob(result.blob, requestedSpeed);
            if (!played && queueVersion === speechQueueVersion) {
              await speakBrowser(sentence, lang, persona, false);
            }
          } catch (err) {
            console.error('Kokoro fail:', err);
            if (queueVersion === speechQueueVersion) {
              await speakBrowser(sentence, lang, persona, false);
            }
          }
        });

      return;
    }

    speechPlaybackQueue = speechPlaybackQueue
      .catch(() => {})
      .then(async () => {
        if (queueVersion !== speechQueueVersion) return;

        await waitUntilAudioAllowed();

        if (queueVersion !== speechQueueVersion) return;

        return speakBrowser(sentence, lang, persona, false);
      });
  }

  function replayLastAssistantSpeech() {
    const text = lastAssistantText.trim();
    if (!text) return;

    isAudioPaused = false;
    resetSpeechQueue();
    updateSpokenAudioButton();
    updatePlaybackButton();
    queueSpeech(text);
  }

  function handleNarrationPreferenceChange(wasEnabled, isEnabled) {
    if (!isEnabled) {
      resetSpeechQueue();
      updateSpokenAudioButton();
      updatePlaybackButton();
      return;
    }

    isAudioPaused = false;
    updateSpokenAudioButton();
    updatePlaybackButton();

    if (!wasEnabled) {
      replayLastAssistantSpeech();
    }
  }

  // Event listeners
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSpeechSpeed(btn.dataset.speed || 'normal');
    });
  });

  if (audioSettingsBtn) {
    audioSettingsBtn.addEventListener('click', () => {
      const willOpen = !document.body.hasAttribute('data-audio-settings-open');
      if (willOpen) {
        document.body.removeAttribute('data-location-panel-open');
        el('location-panel-btn')?.setAttribute('aria-expanded', 'false');
      }
      setAudioSettingsOpen(willOpen);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setAudioSettingsOpen(false);
    });

    setAudioSettingsOpen(false);
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      const value = Number(volumeSlider.value);
      currentVolume = value / 100;
      if (currentVolume > 0) previousVolume = currentVolume;

      if (value === 0) {
        isMuted = true;
        applyAudioSettings();
      } else {
        if (isMuted) isMuted = false;
        applyAudioSettings();
      }

      releaseAudioWaiters();
      updateMuteIcon();
    });

    updateMuteIcon();
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;

      muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
      muteBtn.setAttribute('aria-label', isMuted ? t('audio.unmute', 'Unmute audio') : t('audio.mute', 'Mute audio'));

      if (isMuted) {
        state.accessibilityPrefs.spokenAudio = false;
        if (volumeSlider) volumeSlider.value = 0;
        applyAudioSettings();
      } else {
        state.accessibilityPrefs.spokenAudio = true;
        if (volumeSlider && Number(volumeSlider.value) === 0) {
          volumeSlider.value = Math.round((previousVolume || 0.5) * 100);
        }
        currentVolume = Number(volumeSlider?.value || 50) / 100;
        previousVolume = currentVolume || previousVolume;
        applyAudioSettings();
      }

      document.body.toggleAttribute('data-spoken-audio', state.accessibilityPrefs.spokenAudio);
      syncAccessibilityControls();
      updateSpokenAudioButton();
      releaseAudioWaiters();
      updateMuteIcon();
    });
  }

  if (playbackBtn) {
    playbackBtn.addEventListener('click', () => {
      isAudioPaused = !isAudioPaused;

      if (isAudioPaused) {
        pauseAudioOutput();
      } else {
        resumeAudioOutput();
      }

      updatePlaybackButton();
    });

    updatePlaybackButton();
  }

  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      state.accessibilityPrefs.spokenAudio = true;
      isAudioPaused = false;
      document.body.toggleAttribute('data-spoken-audio', true);
      syncAccessibilityControls();
      replayLastAssistantSpeech();
    });
  }

  if (spokenAudioBtn) {
    spokenAudioBtn.addEventListener('click', () => {
      const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;
      state.accessibilityPrefs.spokenAudio = !state.accessibilityPrefs.spokenAudio;

      document.body.toggleAttribute('data-spoken-audio', state.accessibilityPrefs.spokenAudio);
      syncAccessibilityControls();
      handleNarrationPreferenceChange(wasSpokenAudio, state.accessibilityPrefs.spokenAudio);
    });

    updateSpokenAudioButton();
  }

  window.guiaResetSpeechQueue = resetSpeechQueue;
  window.guiaUpdateSpokenAudio = updateSpokenAudioButton;
  window.guiaReleaseAudioWaiters = releaseAudioWaiters; 
  window.guiaHandleNarrationPreferenceChange = handleNarrationPreferenceChange;
  window.guiaSetLastAssistantText = (text) => {
    if (typeof text === 'string' && text.trim()) {
      lastAssistantText = text.trim();
    }
  };

  return {
    get lastAssistantText() {
      return lastAssistantText;
    },
    set lastAssistantText(value) {
      lastAssistantText = value;
    },
    get currentSpeechSpeed() {
      return currentSpeechSpeed;
    },
    setSpeechSpeed,
    queueSpeech,
    resetSpeechQueue,
    applyAudioSettings,
    resumeAudioOutput
  };
}

// Initial welcome speech

function initInitialWelcomeSpeech(audio) {
  const onboarding = el('onboarding');
  let welcomeSpoken = false;

  function speakInitialWelcome() {
    if (!state.chatStarted) return;
    if (welcomeSpoken) return;

    const firstBubble = q('.assistant-bubble');
    const text = firstBubble?.textContent?.trim();
    if (!text) return;

    welcomeSpoken = true;
    audio.lastAssistantText = text;
    audio.resetSpeechQueue();
    audio.queueSpeech(text, state.selectedLang, state.selectedPersona);
  }

  window.guiaSpeakInitialWelcome = speakInitialWelcome;

  if (!onboarding) return;

  const observer = new MutationObserver(() => {
    const isHidden = onboarding.style.display === 'none';

    if (isHidden) {
      speakInitialWelcome();
      observer.disconnect();
    }
  });

  observer.observe(onboarding, {
    attributes: true,
    attributeFilter: ['style']
  });
}

// Voice input

function initVoiceInput(audio) {
  const micBtn = el('mic-btn');

  if (!micBtn) {
    return {
      isRecording: () => false,
      isProcessing: () => false,
      stopRecording: () => {},
      sendAfterTranscription: () => {}
    };
  }

  const micStatus = el('mic-status');
  const micIcon = micBtn.querySelector('.material-symbols-outlined');
  const inputShell = q('.input-shell');
  const chatInputForVoice = el('chat-input');
  const sendBtnForVoice = el('send-btn');
  const voiceInputStatus = el('voice-input-status');
  const voiceInputStatusText = el('voice-input-status-text');

  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceMimeType = '';
  let voiceRecording = false;
  let voiceProcessing = false;
  let sendAfterVoiceTranscription = false;

  function setVoiceStatus(message, isError = false) {
    if (!micStatus) return;
    if (!message) {
      micStatus.textContent = '';
      micStatus.setAttribute('hidden', '');
      return;
    }
    micStatus.textContent = message;
    micStatus.hidden = false;
    micStatus.style.color = isError ? 'var(--error)' : 'var(--on-surface-variant)';
  }

  function setVoiceButtonState(recording) {
    micBtn.setAttribute('aria-pressed', recording ? 'true' : 'false');
    micBtn.setAttribute('aria-label', recording ? t('audio.stop') : t('audio.voice'));
    micBtn.setAttribute('title', recording ? t('audio.stop') : t('audio.voice'));
    micBtn.classList.toggle('is-listening', recording);
    if (micIcon) micIcon.textContent = recording ? 'stop' : 'mic';
  }

  function setVoiceInputTranscribing(transcribing) {
    inputShell?.classList.toggle('is-transcribing', transcribing);

    if (chatInputForVoice) {
      chatInputForVoice.disabled = transcribing;
      if (transcribing) {
        chatInputForVoice.setAttribute('aria-busy', 'true');
      } else {
        chatInputForVoice.removeAttribute('aria-busy');
      }
    }

    if (sendBtnForVoice) sendBtnForVoice.disabled = false;

    if (!voiceInputStatus) return;
    if (transcribing) {
      if (voiceInputStatusText) {
        voiceInputStatusText.textContent = t('audio.transcribing');
      }
      voiceInputStatus.hidden = false;
    } else {
      voiceInputStatus.setAttribute('hidden', '');
    }
  }

  function cleanupVoiceStream() {
    if (!voiceStream) return;
    voiceStream.getTracks().forEach((track) => track.stop());
    voiceStream = null;
  }

  function supportedVoiceMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function transcribeVoiceRecording() {
    const blob = new Blob(voiceChunks, { type: voiceMimeType || 'audio/webm' });
    if (!blob.size) {
      setVoiceStatus(t('audio.empty'), true);
      return '';
    }

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('lang', state.selectedLang);

    const res = await fetch(API_ENDPOINTS.transcribe, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `Transcription failed with ${res.status}`);
    }

    const data = await res.json();
    const text = (data.text || '').trim();
    if (!text) {
      setVoiceStatus(t('audio.empty'), true);
      return '';
    }

    el('chat-input').value = text;
    setVoiceStatus('');
    return text;
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus(t('audio.unavailable'), true);
      return;
    }

    audio.resetSpeechQueue();
    micBtn.disabled = true;
    setVoiceStatus(t('audio.requesting'));

    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceMimeType = supportedVoiceMimeType();
      voiceRecorder = voiceMimeType
        ? new MediaRecorder(voiceStream, { mimeType: voiceMimeType })
        : new MediaRecorder(voiceStream);
      voiceChunks = [];

      voiceRecorder.ondataavailable = (event) => {
        if (event.data?.size) voiceChunks.push(event.data);
      };

      voiceRecorder.onerror = (event) => {
        console.error('Microphone recording error:', event.error || event);
        setVoiceStatus(t('audio.failed'), true);
      };

      voiceRecorder.onstop = async () => {
        cleanupVoiceStream();
        voiceRecording = false;
        voiceProcessing = true;
        setVoiceButtonState(false);
        setVoiceInputTranscribing(true);
        setVoiceStatus('');

        try {
          const text = await transcribeVoiceRecording();
          if (sendAfterVoiceTranscription && text) {
            sendAfterVoiceTranscription = false;
            setTimeout(() => {
              handleSendRef();
            }, 0);
          }
        } catch (err) {
          console.error('Transcription error:', err);
          setVoiceStatus(t('audio.failed'), true);
        } finally {
          sendAfterVoiceTranscription = false;
          voiceRecorder = null;
          voiceChunks = [];
          voiceMimeType = '';
          voiceProcessing = false;
          micBtn.disabled = false;
          setVoiceInputTranscribing(false);
          if (chatInputForVoice?.value.trim()) chatInputForVoice.focus();
        }
      };

      voiceRecorder.start();
      voiceRecording = true;
      setVoiceButtonState(true);
      setVoiceStatus(t('audio.recording'));
    } catch (err) {
      console.error('Microphone access error:', err);
      cleanupVoiceStream();
      voiceRecorder = null;
      voiceMimeType = '';
      voiceRecording = false;
      setVoiceButtonState(false);
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setVoiceStatus(denied ? t('audio.denied') : t('audio.failed'), true);
    } finally {
      if (!voiceProcessing) micBtn.disabled = false;
    }
  }

  function stopVoiceRecording(sendAfterTranscription = false) {
    if (!voiceRecorder || voiceRecorder.state !== 'recording') return;
    sendAfterVoiceTranscription = sendAfterTranscription;
    micBtn.disabled = true;
    setVoiceInputTranscribing(true);
    setVoiceStatus('');
    voiceRecorder.stop();
  }

  micBtn.addEventListener(
    'click',
    async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (voiceProcessing || micBtn.disabled) return;
      if (voiceRecording) {
        stopVoiceRecording();
      } else {
        await startVoiceRecording();
      }
    },
    true
  );

  // handleSend reference: set after initChat runs.
  let handleSendRef = () => {};

  return {
    isRecording: () => voiceRecording,
    isProcessing: () => voiceProcessing,
    stopRecording: stopVoiceRecording,
    sendAfterTranscription() {
      sendAfterVoiceTranscription = true;
    },
    setHandleSend(fn) {
      handleSendRef = fn;
    }
  };
}

// Context panel

function initContextPanel() {
  const roomSelect = el('room-select');
  const artworkSelect = el('artwork-select');
  const setContextBtn = el('set-context-btn');
  const locationPanelBtn = el('location-panel-btn');
  const manualLocationBtn = el('manual-location-btn');
  const manualLocationPanel = el('manual-location-panel');

  renderLocationSelects();
  enableSelectEnterOpen(roomSelect);
  enableSelectEnterOpen(artworkSelect);

  function setLocationPanelOpen(open) {
    document.body.toggleAttribute('data-location-panel-open', open);
    locationPanelBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      announce(t('app.locationPanelOpened', 'Location panel opened.'));
    } else {
      announce(t('app.locationPanelClosed', 'Location panel closed.'));
    }
  }

  locationPanelBtn?.addEventListener('click', () => {
    const willOpen = !document.body.hasAttribute('data-location-panel-open');
    if (willOpen) {
      document.body.removeAttribute('data-audio-settings-open');
      el('audio-settings-btn')?.setAttribute('aria-expanded', 'false');
    }
    setLocationPanelOpen(willOpen);
  });

  roomSelect?.addEventListener('change', () => {
    roomSelect.removeAttribute('aria-invalid');
    renderArtworkSelect();
  });

  setContextBtn?.addEventListener('click', () => {
    if (!roomSelect.value) {
      el('context-error').textContent = t('app.contextError');
      roomSelect.setAttribute('aria-invalid', 'true');
      roomSelect.focus();
      return;
    }

    const roomText = roomSelect.options[roomSelect.selectedIndex].text;
    const artworkText = artworkSelect.value
      ? artworkSelect.options[artworkSelect.selectedIndex].text
      : '';

    applyContext(roomText, artworkText);
  });

  manualLocationBtn?.addEventListener('click', async () => {
    const willOpen = manualLocationPanel?.hasAttribute('hidden');
    if (willOpen) {
      await loadLocations();
      renderLocationSelects();
      closeQRScanner({ announceClose: false });
      manualLocationPanel?.removeAttribute('hidden');
      announce(t('app.manualSelectionOpened', 'Manual location selection opened.'));
      roomSelect?.focus();
    } else {
      manualLocationPanel?.setAttribute('hidden', '');
      announce(t('app.manualSelectionClosed', 'Manual location selection closed.'));
    }

    manualLocationBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  // ─── Navi Lens Integration ──────────────────────────────────────────────────────────
  let qrScannerActive = false;
  let qrScannerStream = null;

  el('open-app-btn').addEventListener('click', () => {
    const ua = navigator.userAgent;
    const isAndroid = /Android/.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    const storeURL = isAndroid
      ? 'https://play.google.com/store/apps/details?id=com.neosistec.navilensgo'
      : isIOS
      ? 'https://apps.apple.com/us/app/navilens-go/id1313878412'
      : 'https://navilens.com';

    if (isAndroid) {
      window.location.href =
        'intent://com.neosistec.navilensgo#Intent;' +
        'action=android.intent.action.MAIN;' +
        'category=android.intent.category.LAUNCHER;' +
        'package=com.neosistec.navilensgo;' +
        `S.browser_fallback_url=${encodeURIComponent(storeURL)};` +
        'end';

    } else if (isIOS) {
      const fallbackTimer = setTimeout(() => {
        window.location.href = storeURL;
      }, 1500);

      const cancelFallback = () => {
        if (document.hidden) {
          clearTimeout(fallbackTimer);
          document.removeEventListener('visibilitychange', cancelFallback);
        }
      };
      document.addEventListener('visibilitychange', cancelFallback);

      window.location.href = 'navilensgo://';

    } else {
      window.location.href = 'https://navilens.com';
    }
  });

  el('scan-qr-btn').addEventListener('click', async () => {
    const scanner = el('qr-scanner');
    const openAppBtn = el('open-app-btn');
    const scanQrBtn = el('scan-qr-btn');
    const manualLocationBtn = el('manual-location-btn');

    if (qrScannerActive) {
      return;
    }

    try {
      closeManualLocationPanel();
      scanner.removeAttribute('hidden');
      openAppBtn.hidden = true;
      manualLocationBtn.hidden = true;
      scanQrBtn.disabled = true;
      scanQrBtn.setAttribute('aria-expanded', 'true');
      qrScannerActive = true;
      announce(t('app.qrScannerOpened', 'QR scanner opened.'));

      // html5-qrcode will handle camera access internally
      startQRDetection();
      el('close-qr-btn')?.focus();
    } catch (err) {
      console.error('QR scanner error:', err);
      closeQRScanner();
      const cameraError = el('camera-error');
      if (cameraError) {
        cameraError.textContent = t('app.cameraError');
        cameraError.hidden = false;
      }
    }
  });

  el('close-qr-btn').addEventListener('click', () => closeQRScanner({ restoreFocus: true }));

  function closeManualLocationPanel() {
    manualLocationPanel?.setAttribute('hidden', '');
    manualLocationBtn?.setAttribute('aria-expanded', 'false');
  }

  async function closeQRScanner({ announceClose = true, restoreFocus = false } = {}) {
    const scanner = el('qr-scanner');
    const openAppBtn = el('open-app-btn');
    const scanQrBtn = el('scan-qr-btn');
    const manualLocationBtn = el('manual-location-btn');
    const cameraError = el('camera-error');
    const qrVideo = el('qr-video');

    const wasActive = qrScannerActive || !scanner.hasAttribute('hidden');
    scanner.setAttribute('hidden', '');
    openAppBtn.hidden = false;
    manualLocationBtn.hidden = false;
    scanQrBtn.disabled = false;
    scanQrBtn.setAttribute('aria-expanded', 'false');
    qrScannerActive = false;
    if (cameraError) cameraError.hidden = true;
    if (announceClose && wasActive) {
      announce(t('app.qrScannerClosed', 'QR scanner closed.'));
    }

    // Stop the html5-qrcode scanner if active
    if (html5QrCodeScanner) {
      const scannerInstance = html5QrCodeScanner;
      html5QrCodeScanner = null;
      try {
        await scannerInstance.stop();
      } catch (err) {
        console.warn('QR scanner stop skipped:', err);
      }

      try {
        await scannerInstance.clear();
      } catch (err) {
        console.warn('QR scanner clear skipped:', err);
      }
    }

    if (qrVideo) qrVideo.innerHTML = '';
    if (restoreFocus) scanQrBtn.focus();
  }

  let html5QrCodeScanner = null;

  function startQRDetection() {
    if (!window.Html5Qrcode) {
      console.error('Html5Qrcode library not loaded');
      el('context-error').textContent = 'QR code library not loaded';
      return;
    }

    // Create a new Html5Qrcode instance with the div element ID
    html5QrCodeScanner = new Html5Qrcode('qr-video');

    const onScanSuccess = (decodedText) => {
      console.log('QR Code detected:', decodedText);
      announce(t('app.qrScanSuccess', 'QR code scanned.'));
      handleQRCodeDetected(decodedText);
      closeQRScanner({ announceClose: false });
    };

    const onScanFailure = (error) => {
      // QR code not detected in this frame - this is normal, just continue scanning
    };

    // Start scanning
    html5QrCodeScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      },
      onScanSuccess,
      onScanFailure
    ).catch((err) => {
      console.error('Failed to start QR scanning:', err);
      closeQRScanner({ announceClose: false });
      const cameraError = el('camera-error');
      if (cameraError) {
        cameraError.textContent = t('app.cameraError', 'Camera error');
        cameraError.hidden = false;
      }
    });
  }

  function handleQRCodeDetected(data) {
    console.log('QR Code detected:', data);

    try {
      const qrData = JSON.parse(data);
      
      // Extract room and artwork IDs from QR code
      const roomId = qrData.roomId || qrData.room;
      const artworkId = qrData.artworkId || qrData.artwork;
      
      if (!roomId) {
        console.warn('No room ID in QR code');
        el('context-error').textContent = t('app.invalidQR', 'Invalid QR code');
        return;
      }

      // Find room in location data by ID
      const room = (state.locationData.rooms || []).find(r => r.id === roomId);
      if (!room) {
        console.warn('Room not found in location data:', roomId);
        el('context-error').textContent = t('app.roomNotFound', 'Room not found');
        return;
      }

      const roomText = room.label || room.id;
      let artworkText = '';

      // Set room select
      const roomSelect = el('room-select');
      if (roomSelect) {
        roomSelect.value = roomId;
        roomSelect.removeAttribute('aria-invalid');
      }

      // Find artwork if specified in QR code
      if (artworkId) {
        const artwork = (room.artworks || []).find(a => (a.id || a.title) === artworkId);
        if (artwork) {
          artworkText = artwork.title;
          // Set artwork select
          const artworkSelect = el('artwork-select');
          if (artworkSelect) {
            artworkSelect.value = artworkId;
          }
        } else {
          console.warn('Artwork not found in room:', artworkId);
        }
      }

      // Re-render artwork select to ensure it's updated
      renderArtworkSelect();

      // Apply context which updates state.currentRoom and state.currentArtwork
      applyContext(roomText, artworkText);
    } catch (err) {
      console.error('Failed to parse QR code:', err);
      el('context-error').textContent = t('app.invalidQR', 'Invalid QR code format');
    }
  }

  // Chat
  function speakBrowser(text, lang = state.selectedLang, persona = "adult", cancelExisting = true) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);

      const langMap = {
        en: "en-US",
        es: "es-ES",
        ca: "ca-ES"
      };

      utterance.lang = langMap[lang];

      const config = {
        child:  { pitch: 1.6, rate: 1.05 },
        teen:   { pitch: 1.2, rate: 1.0 },
        adult:  { pitch: 1.0, rate: 0.95 },
        senior: { pitch: 0.9, rate: 0.9 }
      };

      const style = config[persona] || config.adult;

      utterance.pitch = style.pitch;
      utterance.volume = isMuted || !spokenAudioEnabled ? 0 : currentVolume;
      const speedRate = {
        slow: 0.8,
        normal: 1,
        fast: 1.2
      };

      utterance.rate = style.rate * (speedRate[currentSpeechSpeed] || 1);
      utterance.onend = resolve;
      utterance.onerror = resolve;

      if (cancelExisting) speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
  }

  async function fetchKokoroAudio(text, lang = state.selectedLang) {
    const res = await fetch("http://127.0.0.1:5000/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lang,
        speed: currentSpeechSpeed
      })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return res.blob();
  }

  function playAudioBlob(blob, generatedSpeed = currentSpeechSpeed) {
    return new Promise(async (resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      currentAudioBaseSpeed = generatedSpeed;
      applyAudioSettings(audio);

      const cleanup = () => {
        if (currentAudio === audio) {
          currentAudio = null;
        }

        URL.revokeObjectURL(url);
        resolve();
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;

      try {
        await waitUntilAudioAllowed();

        if (currentAudio !== audio) {
          cleanup();
          return;
        }

        await audio.play();
      } catch (err) {
        console.error("Audio playback failed:", err);
        cleanup();
      }
    });
  }

  let speechPlaybackQueue = Promise.resolve();
  let speechQueueVersion = 0;
  let currentAudio = null;
}

// Chat

function initChat(audio, voice) {
  const chatThread = el('chat-thread');
  const chatInput = el('chat-input');
  const sendBtn = el('send-btn');
  const typingIndicator = el('typing-indicator');

  let isGenerating = false;

  function setThinkingIndicator(isThinking) {
    if (!typingIndicator) return;

    if (isThinking) {
      typingIndicator.hidden = false;
      typingIndicator.removeAttribute('hidden');
      typingIndicator.setAttribute('aria-hidden', 'false');
      typingIndicator.classList.add('is-visible');
      typingIndicator.style.display = 'inline-flex';
    } else {
      typingIndicator.hidden = true;
      typingIndicator.setAttribute('hidden', '');
      typingIndicator.setAttribute('aria-hidden', 'true');
      typingIndicator.classList.remove('is-visible');
      typingIndicator.style.display = 'none';
    }
  }

  function appendToBubble(bubble, text) {
    bubble.textContent += text;
    updateBubbleAccessibilityLabel(bubble, 'assistant');
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function extractCompleteSentences(buffer) {
    const sentences = [];
    const sentenceEndPattern = /[.!?\u3002\uff01\uff1f]+(?=\s|$)/g;
    let lastEnd = 0;
    let match;

    while ((match = sentenceEndPattern.exec(buffer)) !== null) {
      const end = sentenceEndPattern.lastIndex;
      const sentence = buffer.slice(lastEnd, end).trim();
      if (sentence) sentences.push(sentence);
      lastEnd = end;
      while (buffer[lastEnd] === ' ' || buffer[lastEnd] === '\n') lastEnd += 1;
    }

    return {
      sentences,
      remainder: buffer.slice(lastEnd)
    };
  }

  async function readNdjsonStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        onEvent(JSON.parse(line));
      }
    }

    pending += decoder.decode();
    if (pending.trim()) onEvent(JSON.parse(pending));
  }

  async function streamAssistantReply(payload) {
    let assistantBubble = null;
    let receivedText = false;
    let sentenceBuffer = '';
    let fullAssistantText = '';

    try {
      const res = await fetch(API_ENDPOINTS.chatStream, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      if (!res.body) {
        throw new Error('This browser does not support streamed responses.');
      }

      await readNdjsonStream(res, (event) => {
        if (event.type === 'delta') {
          const text = event.text || '';
          if (!text) return;

          if (!receivedText) {
            receivedText = true;
            setThinkingIndicator(false);
            assistantBubble = addBubble('assistant', '');
          }

          appendToBubble(assistantBubble, text);
          sentenceBuffer += text;
          fullAssistantText += text;

          if (!payload.simple_language) {
            const extracted = extractCompleteSentences(sentenceBuffer);
            extracted.sentences.forEach((sentence) => audio.queueSpeech(sentence));
            sentenceBuffer = extracted.remainder;
          }
        } else if (event.type === 'replace') {
          const text = event.text || '';
          if (!text) return;

          if (!receivedText) {
            receivedText = true;
            setThinkingIndicator(false);
            assistantBubble = addBubble('assistant', '');
          }

          assistantBubble.textContent = text;
          updateBubbleAccessibilityLabel(assistantBubble, 'assistant');
          fullAssistantText = text;
          sentenceBuffer = '';
          chatThread.scrollTop = chatThread.scrollHeight;

          if (payload.simple_language) {
            audio.resetSpeechQueue();
            audio.queueSpeech(text);
          }
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Streaming chat failed');
        }
      });

      if (!payload.simple_language && sentenceBuffer.trim()) {
        audio.queueSpeech(sentenceBuffer);
      }

      if (fullAssistantText.trim()) {
        audio.lastAssistantText = fullAssistantText.trim();
      }

      if (assistantBubble && !payload.simple_language) {
        await annotateEasyWords(assistantBubble);
      }

      if (!receivedText) {
        const emptyBubble = addBubble('assistant', t('chat.emptyResponse', "I couldn't generate a response."));
        if (!payload.simple_language) {
          await annotateEasyWords(emptyBubble);
        }
      }
    } finally {
      setThinkingIndicator(false);
    }
  }

  async function handleSend() {
    if (isGenerating) return;

    if (voice.isRecording()) {
      voice.stopRecording(true);
      return;
    }

    if (voice.isProcessing()) {
      voice.sendAfterTranscription();
      return;
    }

    const value = chatInput.value.trim();
    if (!value) return;

    addBubble('user', value);
    chatInput.value = '';

    audio.resetSpeechQueue();
    setThinkingIndicator(true);

    isGenerating = true;
    sendBtn.disabled = true;

    try {
      await streamAssistantReply({
        session_id: sessionId,
        message: value,
        language: state.selectedLang,
        age_range: state.selectedAge || 'adult',
        personality: state.selectedPersona,
        simple_language: state.accessibilityPrefs.simpleLanguage,
        visual_descriptions: state.accessibilityPrefs.visualDescriptions,
        more_time: state.accessibilityPrefs.moreTime,
        room: state.currentRoom,
        artwork: state.currentArtwork
      });
    } catch (e) {
      console.error('Chat error:', e);
      setThinkingIndicator(false);
      addBubble('assistant', t('chat.connectionError'));
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      setThinkingIndicator(false);
    }
  }

  // Wire handleSend into the voice module so onstop can call it
  voice.setHandleSend(handleSend);

  function initSuggestionButtons() {
    qa('.suggestion-btn').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        if (index === 0) {
          chatInput.value = btn.textContent.trim();
          handleSend();
          return;
        }

        if (index === 1) {
          if (!audio.lastAssistantText.trim()) return;
          audio.resetSpeechQueue();
          audio.queueSpeech(audio.lastAssistantText);
          return;
        }

        if (index === 2) {
          audio.setSpeechSpeed('slow');
          chatInput.value = btn.textContent.trim();
          handleSend();
        }
      });
    });
  }

  setThinkingIndicator(false);
  initSuggestionButtons();

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  return { handleSend };
}

// Apply context

function applyContext(roomText, artworkText) {
  state.currentRoom = roomText;
  state.currentArtwork = artworkText;

  const roomEl = el('current-room');
  const artworkEl = el('current-artwork');
  if (roomEl) roomEl.textContent = t('app.room') + ': ' + roomText;
  if (artworkEl) artworkEl.textContent = t('app.artwork') + ': ' + (artworkText || t('context.notSet'));

  el('context-error').textContent = '';
  el('room-select').removeAttribute('aria-invalid');

  const msg = artworkText ? `${roomText} \u00b7 ${artworkText}` : roomText;
  addBubble('user', msg);
  el('manual-location-panel')?.setAttribute('hidden', '');
  el('manual-location-btn')?.setAttribute('aria-expanded', 'false');
  document.body.removeAttribute('data-location-panel-open');
  el('location-panel-btn')?.setAttribute('aria-expanded', 'false');

  fetch(API_ENDPOINTS.context, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      room: roomText,
      artwork: artworkText
    })
  }).catch((e) => console.warn('Could not send context to backend:', e));
}
