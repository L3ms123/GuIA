// ─── State ────────────────────────────────────────────────────────────────────
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

  accessibilityPrefs: {
    largeText: false,
    simpleLanguage: false,
    audio: false,
    moreTime: false,
    visualDescriptions: false
  }
};

const sessionId = crypto.randomUUID();

const AGE_RANGE_BY_KEY = {
  young: 'Young person 10-19 years old',
  adult: 'Adult 20-60 years old',
  senior: 'Senior 60+ years old'
};

const SPEECH_PLAYBACK_RATE = {
  slow: 0.65,
  normal: 1,
  fast: 1.65
};

window.USE_KOKORO = true;

// ─── i18n ─────────────────────────────────────────────────────────────────────

function getNestedTranslation(source, key) {
  return key.split('.').reduce((obj, k) => (obj ? obj[k] : undefined), source);
}

function t(key, fallback = '') {
  const currentLang = state.translations[state.selectedLang];
  const caLang = state.translations['ca'];

  return (
    getNestedTranslation(currentLang, key) ??
    getNestedTranslation(caLang, key) ??
    fallback ??
    key
  );
}

function showOnboarding() {
  window.guiaResetSpeechQueue?.();
  const onboarding = el('onboarding');
  onboarding.style.display = 'flex';
  onboarding.removeAttribute('aria-hidden');
  document.body.toggleAttribute('data-onboarding-open', true);
}

function hideOnboarding() {
  const onboarding = el('onboarding');
  onboarding.style.display = 'none';
  onboarding.setAttribute('aria-hidden', 'true');
  document.body.removeAttribute('data-onboarding-open');
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

  // panel
  const titleEl = el('onboarding-title');
  if (titleEl) titleEl.textContent = t('onboarding.title');
  const descEl = el('onboarding-desc');
  if (descEl) descEl.textContent  = t('onboarding.description');

  // Section labels — addressed by ID on each <h2>
  const labelLang = el('label-language');
  if (labelLang) labelLang.textContent = t('onboarding.language');
  const labelPersona = el('label-personality');
  if (labelPersona) labelPersona.textContent = t('onboarding.personality');
  const labelVisitor = el('label-visitor');
  if (labelVisitor) labelVisitor.textContent = t('onboarding.visitor');

  // Personas
  ['artist', 'storyteller', 'explorer', 'scholar'].forEach((key) => {
    const btn = document.querySelector(`[data-persona="${key}"]`);
    if (!btn) return;
    const titleNode = btn.querySelector('.card-title');
    const subNode = btn.querySelector('.card-subtitle');
    if (titleNode) titleNode.textContent = t(`personas.${key}.title`);
    if (subNode) subNode.textContent = t(`personas.${key}.subtitle`);
  });

  // Age chips
  ['young', 'adult', 'senior'].forEach((key) => {
    const btn = document.querySelector(`[data-age="${key}"]`);
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

    title.textContent = t(`ages.${key}.title`);
    if (sub) sub.textContent = t(`ages.${key}.subtitle`);
  });

  const ageHint = el('age-hint');
  if (ageHint) ageHint.textContent = t('ageHint');

  // STEP 2: Accessibility
  const labelAccessibility = el('label-accessibility');
  if (labelAccessibility) labelAccessibility.textContent = t('onboarding.accessibility');

  const stepHelp = el('accessibility-help');
  if (stepHelp) stepHelp.textContent = t('onboarding.accessibilityHelp');
  
  const optLargeTextLabel = document.querySelector('label[for="opt-large-text"] span') ||
    document.querySelector('#opt-large-text')?.closest('label')?.querySelector('span');
  if (optLargeTextLabel) optLargeTextLabel.textContent = t('onboarding.largeText');

  const optSimpleLanguageLabel = document.querySelector('label[for="opt-simple-language"] span') ||
    document.querySelector('#opt-simple-language')?.closest('label')?.querySelector('span');
  if (optSimpleLanguageLabel) optSimpleLanguageLabel.textContent = t('onboarding.simpleLanguage');
  const optSimpleLanguageHelp = document.querySelector('#opt-simple-language')?.closest('label')?.querySelector('.card-subtitle');
  if (optSimpleLanguageHelp) optSimpleLanguageHelp.textContent = t('onboarding.simpleLanguageHelp');

  const optCaptionsLabel = document.querySelector('label[for="opt-captions"] span') ||
    document.querySelector('#opt-captions')?.closest('label')?.querySelector('span');
  if (optCaptionsLabel) optCaptionsLabel.textContent = t('onboarding.spokenExplanations');

  const optMoreTimeLabel = document.querySelector('label[for="opt-more-time"] span') ||
    document.querySelector('#opt-more-time')?.closest('label')?.querySelector('span');
  if (optMoreTimeLabel) optMoreTimeLabel.textContent = t('onboarding.moreTime');

  const optVisualDescriptionsLabel = document.querySelector('#opt-visual-descriptions')?.closest('label')?.querySelector('span');
  if (optVisualDescriptionsLabel) optVisualDescriptionsLabel.textContent = t('onboarding.visualDescriptions');

  // STEP 3: Privacy
  const privacyLabel = document.querySelector('[data-i18n="onboarding.privacy"]');
  if (privacyLabel) {
    privacyLabel.textContent = t('onboarding.privacy');
  } else {
    const privacyHeading = document.querySelector('.onboarding-step[data-step="3"] .section-label');
    if (privacyHeading) privacyHeading.textContent = t('onboarding.privacy');
  }

  const privacyParagraphs = document.querySelectorAll('.onboarding-step[data-step="3"] .info-block p');
  if (privacyParagraphs[0]) privacyParagraphs[0].textContent = t('onboarding.privacyIntro1');
  if (privacyParagraphs[1]) privacyParagraphs[1].textContent = t('onboarding.privacyIntro2');
  if (privacyParagraphs[2]) privacyParagraphs[2].textContent = t('onboarding.privacyIntro3');
  if (privacyParagraphs[3]) privacyParagraphs[3].textContent = t('onboarding.privacyIntro4');
  if (privacyParagraphs[4]) privacyParagraphs[4].textContent = t('onboarding.privacyIntro5');

  const consentLabel = document.querySelector('#privacy-consent')?.closest('label')?.querySelector('span');
  if (consentLabel) consentLabel.textContent = t('onboarding.privacyConsent');
  
  // Next button text — update step label if visible
  updateOnboardingButtons();
}

function onboardingEls() {
  return {
    steps: [...document.querySelectorAll('.onboarding-step')],
    backBtn: document.getElementById('onboarding-back'),
    nextBtn: document.getElementById('onboarding-next'),
    stepCount: document.getElementById('step-count'),
    stepFill: document.querySelector('.step-bar-fill'), 
    consent: document.getElementById('privacy-consent')
  };
}

function showOnboardingStep(step) {
  state.onboardingStep = step;
  const { steps, backBtn, nextBtn, stepCount, stepFill } = onboardingEls();
  const onboardingPanel = document.querySelector('.onboarding-panel');
  const onboardingBody = document.querySelector('.onboarding-body');

  steps.forEach(section => {
    section.hidden = Number(section.dataset.step) !== step;
  });

  requestAnimationFrame(() => {
    if (onboardingPanel) onboardingPanel.scrollTop = 0;
    if (onboardingBody) onboardingBody.scrollTop = 0;
  });

  // progreso barra
  if (stepFill) {
    const percent = (step / state.totalSteps) * 100;
    stepFill.style.width = `${percent}%`;
  }
  backBtn.hidden = step === 1;
  nextBtn.textContent = step === state.totalSteps ? 'Start' : 'Continue';
  
  const desc = document.getElementById('onboarding-desc');
  if (desc) {
    if (step === 1) {
      desc.textContent = t('onboarding.description');
      desc.hidden = false;
    } else if (step === 2) {
      desc.textContent = t('onboarding.accessibilityHelp');
      desc.hidden = false;
    } else {
      desc.hidden = true;
    }
  }

  updateOnboardingButtons();
}

function updateOnboardingButtons() {
  const backBtn = el('onboarding-back');
  const nextBtn = el('onboarding-next');
  const stepCount = el('step-count');
  const consent = el('privacy-consent');

  if (stepCount) {
    const template = t('onboarding.stepCount', 'Step {current} of {total}');
    stepCount.textContent = template
      .replace('{current}', state.onboardingStep)
      .replace('{total}', state.totalSteps);
  }

  if (backBtn) {
    backBtn.textContent = t('onboarding.back', 'Back');
    backBtn.hidden = state.onboardingStep === 1;
  }

  if (nextBtn) {
    nextBtn.textContent = state.onboardingStep === state.totalSteps
      ? t('onboarding.start', 'Start')
      : t('onboarding.continue', 'Continue');
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
  document.body.toggleAttribute('data-captions', state.accessibilityPrefs.captions);
  document.body.toggleAttribute('data-more-time', state.accessibilityPrefs.moreTime);
  document.body.toggleAttribute('data-visual-descriptions', state.accessibilityPrefs.visualDescriptions);

  if (state.accessibilityPrefs.largeText) {
    document.body.setAttribute('data-mode', 'senior');
  } else if (document.body.dataset.mode === 'senior' && state.selectedAge !== 'senior') {
    document.body.setAttribute('data-mode', 'regular');
  }

  if (state.accessibilityPrefs.moreTime) {
    setPreferredSpeechSpeed('slow');
  }
}

function setPreferredSpeechSpeed(speed) {
  const btn = document.querySelector(`.speed-btn[data-speed="${speed}"]`);
  if (btn && btn.getAttribute('aria-checked') !== 'true') {
    btn.click();
  }
}

function bindOnboardingFlow() {
  const { backBtn, nextBtn, consent } = onboardingEls();

  document.querySelectorAll('.interaction-card').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedInteraction = btn.dataset.interaction;

      document.querySelectorAll('.interaction-card').forEach(card => {
        card.setAttribute('aria-checked', String(card === btn));
      });

      updateOnboardingButtons();
    });
  });

  document.getElementById('opt-large-text')?.addEventListener('change', e => {
    state.accessibilityPrefs.largeText = e.target.checked;
  });

  document.getElementById('opt-simple-language')?.addEventListener('change', e => {
    state.accessibilityPrefs.simpleLanguage = e.target.checked;
  });

  document.getElementById('opt-captions')?.addEventListener('change', e => {
    state.accessibilityPrefs.captions = e.target.checked;
  });

  document.getElementById('opt-more-time')?.addEventListener('change', e => {
    state.accessibilityPrefs.moreTime = e.target.checked;
  });

  document.getElementById('opt-visual-descriptions')?.addEventListener('change', e => {
    state.accessibilityPrefs.visualDescriptions = e.target.checked;
  });

  consent?.addEventListener('change', updateOnboardingButtons);

  backBtn?.addEventListener('click', () => {
    if (state.onboardingStep > 1) showOnboardingStep(state.onboardingStep - 1);
  });

  nextBtn?.addEventListener('click', () => {
    if (state.onboardingStep < state.totalSteps) {
      showOnboardingStep(state.onboardingStep + 1);
      return;
    }

    applyAccessibilityPrefs();
    hideOnboarding(); 
    applyAppTranslations();
  });

  showOnboardingStep(1);
}

// Main page
function applyAppTranslations() {
  if (!state.translations[state.selectedLang]) return;

  // Botones de velocidad
  const speedBtns = Array.from(document.querySelectorAll('.speed-btn'));
  const speedKeys = ['slow', 'normal', 'fast'];
  speedBtns.forEach((btn, i) => {
    btn.textContent = t(`audio.${speedKeys[i]}`);
  });

  const audioLabel = document.querySelector('.audio-label');
  if (audioLabel) audioLabel.textContent = t('audio.volume', 'Volume');

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

  const replayBtn = el('audio-replay-btn');
  if (replayBtn) replayBtn.setAttribute('aria-label', t('audio.replay', 'Replay last answer'));

  // Mensaje de bienvenida en el chat
  const firstBubble = document.querySelector('.assistant-bubble');
  if (firstBubble) firstBubble.textContent = t('chat.welcome');

  // Sugerencias
  const suggBtns = Array.from(document.querySelectorAll('.suggestion-btn'));
  const suggestions = t('chat.suggestions');
  suggBtns.forEach((btn, i) => {
    if (suggestions[i]) btn.textContent = suggestions[i];
  });

  // Botón "Where am I?"
  const whereAmIBtn = el('where-am-i-btn');
  if (whereAmIBtn) whereAmIBtn.textContent = t('app.whereAmI');

  // Título principal
  const brandTitle = document.querySelector('.brand-title');
  if (brandTitle) brandTitle.textContent = t('app.title');

  const appTitle = el('app-title');
  if (appTitle) {
    appTitle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">arrow_back</span><span></span>';
    const label = appTitle.querySelector('span:last-child');
    if (label) label.textContent = t('app.settings', 'Settings');
    appTitle.setAttribute('aria-label', t('app.openSettings', 'Open guide settings'));
  }

  // Context panel labels (optional elements)
  const chooseLocation = el('choose-location');
  if (chooseLocation) chooseLocation.textContent = t('app.chooseLocation');
  const roomLabel = el('room');
  if (roomLabel) roomLabel.textContent = t('app.room');
  const artworkLabel = el('artwork');
  if (artworkLabel) artworkLabel.textContent = t('app.artwork');

  // Opciones del select de sala
  renderLocationSelects();

  // Context suggestion (optional)
  renderContextSuggestion();
  const confirmSuggBtn = el('confirm-suggestion-btn');
  if (confirmSuggBtn) confirmSuggBtn.textContent = t('app.confirmSuggestion');

  // Footer
  const helperText = document.querySelector('.helper-text');
  if (helperText) helperText.textContent = t('chat.helper');
  const chatInputEl = el('chat-input');
  if (chatInputEl) chatInputEl.placeholder = getChatPlaceholder();
  const sendBtnEl = el('send-btn');
  if (sendBtnEl) sendBtnEl.textContent = t('chat.send');
}

function getChatPlaceholder() {
  if (!window.matchMedia('(max-width: 640px)').matches) {
    return t('chat.placeholder');
  }

  const compact = {
    en: 'Ask GuIA...',
    es: 'Pregunta a GuIA...',
    ca: 'Pregunta a GuIA...'
  };
  return compact[state.selectedLang] || compact.en;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function el(id) {
  return document.getElementById(id);
}

function selectRadio(buttons, clicked) {
  buttons.forEach((b) =>
    b.setAttribute('aria-checked', b === clicked ? 'true' : 'false')
  );
}

function addBubble(role, text) {
  const chatThread = el('chat-thread');
  const row        = document.createElement('div');
  row.className    = `msg-row ${role}`;
  const bubble     = document.createElement('div');
  bubble.className = `msg-bubble ${role === 'user' ? 'user-bubble' : 'assistant-bubble'}`;
  bubble.textContent = text;
  row.appendChild(bubble);
  chatThread.appendChild(row);
  chatThread.scrollTop = chatThread.scrollHeight;
  return bubble;
}

function easyWordAnnotationsEnabled() {
  return state.accessibilityPrefs.simpleLanguage;
}

async function annotateEasyWords(bubble) {
  if (!bubble || !easyWordAnnotationsEnabled()) return;

  const text = bubble.textContent.trim();
  if (!text) return;

  try {
    const res = await fetch('http://127.0.0.1:5002/easy-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: state.selectedLang })
    });

    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.rewritten_text === 'string' && data.rewritten_text.trim()) {
      bubble.textContent = data.rewritten_text.trim();
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
    const label = item.replacement
      ? `${match[0]}: ${item.definition}`
      : item.definition;
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
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadLocations() {
  try {
    const res = await fetch("http://127.0.0.1:5002/locations");
    if (!res.ok) throw new Error(await res.text());
    state.locationData = await res.json();
  } catch (e) {
    console.warn("Could not load museum locations from backend:", e);
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
  const suggestion = document.querySelector('.context-suggestion');
  if (!suggestion) return;

  const firstRoom = (state.locationData.rooms || [])[0];
  const firstArtwork = firstRoom?.artworks?.[0];
  const textNode = Array.from(suggestion.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);

  if (!firstRoom || !textNode) return;

  const roomLabel = firstRoom.label || firstRoom.id;
  const artworkLabel = firstArtwork?.title;
  const prefix = {
    en: 'Are you in',
    es: 'Estás en',
    ca: 'Estàs a'
  }[state.selectedLang];
  textNode.textContent = artworkLabel
    ? `${prefix} ${roomLabel}, ${artworkLabel}? `
    : `${prefix} ${roomLabel}? `;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function loadTranslations() {
  try {
    const res    = await fetch('translations.json');
    state.translations = await res.json();
  } catch (e) {
    console.error('translations.json not found — serving without i18n', e);
    state.translations = {};
  }
  await loadLocations();

  // Lee el idioma por defecto del aria-checked="true" en el HTML
  const preChecked = document.querySelector('#language-group [aria-checked="true"]');
  if (preChecked) state.selectedLang = preChecked.dataset.lang;

  applyOnboardingTranslations();
  initLanguageSelector();
  initPersonaButtons();
  initAgeButtons();

  bindOnboardingFlow();

  initAppTitleButton();
  initApp();
  applyAppTranslations();
  window.addEventListener('resize', applyAppTranslations);
}

document.addEventListener('DOMContentLoaded', loadTranslations);

// ─── Onboarding ───────────────────────────────────────────────────────────────

function initLanguageSelector() {
  const btns = Array.from(document.querySelectorAll('#language-group [data-lang]'));

  // Set aria-checked to match default selectedLang
  btns.forEach((b) =>
    b.setAttribute('aria-checked', b.dataset.lang === state.selectedLang ? 'true' : 'false')
  );

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedLang = btn.dataset.lang;
      selectRadio(btns, btn);
      applyOnboardingTranslations();
      applyAppTranslations();
      updateOnboardingButtons();
    });
  });
}

function initPersonaButtons() {
  const btns = Array.from(document.querySelectorAll('[data-persona]'));
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedPersona = btn.dataset.persona;
      selectRadio(btns, btn);
      updateOnboardingButtons();
    });
  });
}

function initAgeButtons() {
  const btns = Array.from(document.querySelectorAll('[data-age]'));
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

// ─── Main app ─────────────────────────────────────────────────────────────────

function initApp() {
  // Speed radios
  const speedBtns = Array.from(document.querySelectorAll('.speed-btn'));
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSpeechSpeed(btn.dataset.speed || 'normal');
    });
  });
  
  const onboarding = el('onboarding');

  if (onboarding) {
    const observer = new MutationObserver(() => {
      const isHidden = onboarding.style.display === 'none';

      if (isHidden) {
        speakInitialWelcome();
        observer.disconnect(); // solo una vez
      }
    });

    observer.observe(onboarding, {
      attributes: true,
      attributeFilter: ['style']
    });
  }

  // ─── Volume slider + Mute ─────────────────────────────────────────────────────
  const muteBtn      = el('mute-btn');
  const volumeSlider = el('volume-slider');
  const playbackBtn = el('audio-playback-btn');
  const replayBtn = el('audio-replay-btn');
  const spokenAudioBtn = el('spoken-audio-btn');
  const audioSettingsBtn = el('audio-settings-btn');
  let isMuted        = false;
  let isAudioPaused = false;
  let spokenAudioEnabled = true;
  let currentVolume = 0.5;
  let previousVolume = 0.5;
  let audioWaiters  = [];
  let currentAudioBaseSpeed = 'normal';

  function setAudioSettingsOpen(open) {
    document.body.toggleAttribute('data-audio-settings-open', open);
    if (!audioSettingsBtn) return;

    audioSettingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    audioSettingsBtn.setAttribute(
      'aria-label',
      open ? t('audio.closeSettings', 'Close audio settings') : t('audio.openSettings', 'Open audio settings')
    );
  }

  if (audioSettingsBtn) {
    audioSettingsBtn.addEventListener('click', () => {
      setAudioSettingsOpen(!document.body.hasAttribute('data-audio-settings-open'));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setAudioSettingsOpen(false);
    });

    setAudioSettingsOpen(false);
  }

  function updateMuteIcon() {
    if (!muteBtn) return;
    const muted = isMuted || currentVolume === 0;
    muteBtn.textContent = muted ? '🔇' : '🔈';
    if (!muteBtn) return;
    muteBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${muted ? 'volume_off' : 'volume_up'}</span>`;
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', muted ? t('audio.unmute', 'Unmute audio') : t('audio.mute', 'Mute audio'));
  }

  function updatePlaybackButton() {
    if (!playbackBtn) return;

    const icon = playbackBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = isAudioPaused ? 'play_arrow' : 'pause';
    playbackBtn.setAttribute('aria-pressed', isAudioPaused ? 'true' : 'false');
    playbackBtn.setAttribute(
      'aria-label',
      isAudioPaused ? t('audio.resume', 'Resume audio') : t('audio.pause', 'Pause audio')
    );
  }

  function updateSpokenAudioButton() {
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
    const baseRate = SPEECH_PLAYBACK_RATE[currentAudioBaseSpeed] || 1;
    const targetRate = SPEECH_PLAYBACK_RATE[currentSpeechSpeed] || 1;
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

  function releaseAudioWaiters() {
    if (!canPlayAudio()) return;

    resolveAudioWaiters();
  }

  function resolveAudioWaiters() {
    const waiters = audioWaiters;
    audioWaiters = [];
    waiters.forEach((resolve) => resolve());
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
        console.error("Audio resume failed:", err);
      });
    }
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }
    releaseAudioWaiters(); 
  }

  // Volume slider: fuera de resumeAudioOutput ↓
  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      const value = Number(volumeSlider.value);
      currentVolume = value / 100;
      if (currentVolume > 0) previousVolume = currentVolume;

      if (value === 0) {
        isMuted = true;
        applyAudioSettings();
      } else {
        if (isMuted) {
          isMuted = false;
        }
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
      muteBtn.textContent = isMuted ? '🔇' : '🔈';
      muteBtn.setAttribute(
        'aria-label',
        isMuted ? 'Unmute audio' : 'Mute audio'
      );

      if (isMuted) {
        if (volumeSlider) volumeSlider.value = 0;
        applyAudioSettings();
      } else {
        if (volumeSlider && Number(volumeSlider.value) === 0) {
          volumeSlider.value = Math.round((previousVolume || 0.5) * 100);
        }
        currentVolume = Number(volumeSlider?.value || 50) / 100;
        previousVolume = currentVolume || previousVolume;
        applyAudioSettings();
      }
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
      const text = lastAssistantText.trim();
      if (!text) return;

      spokenAudioEnabled = true;
      isAudioPaused = false;
      resetSpeechQueue();
      updateSpokenAudioButton();
      updatePlaybackButton();
      queueSpeech(text);
    });
  }

  if (spokenAudioBtn) {
    spokenAudioBtn.addEventListener('click', () => {
      spokenAudioEnabled = !spokenAudioEnabled;

      if (!spokenAudioEnabled) {
        resetSpeechQueue();
      } else {
        resumeAudioOutput();
      }

      updateSpokenAudioButton();
    });
    updateSpokenAudioButton();
  }

  function speakInitialWelcome() {
    const firstBubble = document.querySelector(".assistant-bubble");
    const text = firstBubble?.textContent?.trim();
    if (!text) return;

    lastAssistantText = text;
    resetSpeechQueue();
    queueSpeech(text, state.selectedLang, state.selectedPersona);
  }

  // speakInitialWelcome is called from bindOnboardingFlow when the final step completes

  // Mic
  const micBtn = el('mic-btn');
  if (!micBtn) return;
  const micStatus = el('mic-status');
  const micIcon = micBtn.querySelector('.material-symbols-outlined');
  const inputShell = document.querySelector('.input-shell');
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
    micBtn.setAttribute(
      'aria-label',
      recording ? t('audio.stop') : t('audio.voice')
    );
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
    const preferredTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4'
    ];
    return preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
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

    const res = await fetch('http://127.0.0.1:5000/transcribe', {
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

    resetSpeechQueue();
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
              handleSend();
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

  micBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (voiceProcessing || micBtn.disabled) return;
    if (voiceRecording) {
      stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  }, true);

  // Where am I panel
  el('where-am-i-btn').addEventListener('click', async () => {
    const box = el('context-box');
    if (box.hasAttribute('hidden')) {
      await loadLocations();
      renderLocationSelects();
      box.removeAttribute('hidden');
    } else {
      box.setAttribute('hidden', '');
    }
  });

  // Set context
  const roomSelect    = el('room-select');
  const artworkSelect = el('artwork-select');
  renderLocationSelects();

  roomSelect.addEventListener('change', () => {
    roomSelect.removeAttribute('aria-invalid');
    renderArtworkSelect();
  });

  el('set-context-btn').addEventListener('click', () => {
    if (!roomSelect.value) {
      el('context-error').textContent = t('app.contextError');
      roomSelect.setAttribute('aria-invalid', 'true');
      roomSelect.focus();
      return;
    }
    const roomText    = roomSelect.options[roomSelect.selectedIndex].text;
    const artworkText = artworkSelect.value
      ? artworkSelect.options[artworkSelect.selectedIndex].text
      : '';

    applyContext(roomText, artworkText);
});

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

  const chatThread = el('chat-thread');
  const chatInput  = el('chat-input');
  const sendBtn = el('send-btn');
  const typingIndicator = el('typing-indicator');
  let isGenerating = false;
  let lastAssistantText = '';
  let currentSpeechSpeed = 'normal';

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
  window.guiaResetSpeechQueue = resetSpeechQueue;

  el('app-title')?.addEventListener('click', () => {
    showOnboarding();
  });

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

            await playAudioBlob(result.blob, requestedSpeed);
          } catch (err) {
            console.error("Kokoro fail:", err);
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

  setThinkingIndicator(false);

    function appendToBubble(bubble, text) {
      bubble.textContent += text;
      chatThread.scrollTop = chatThread.scrollHeight;
    }

  function extractCompleteSentences(buffer) {
    const sentences = [];
    const sentenceEndPattern = /[.!?。！？]+(?=\s|$)/g;
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
      const res = await fetch("http://127.0.0.1:5002/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      if (!res.body) {
        throw new Error("This browser does not support streamed responses.");
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
            extracted.sentences.forEach((sentence) => queueSpeech(sentence));
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
          fullAssistantText = text;
          sentenceBuffer = '';
          chatThread.scrollTop = chatThread.scrollHeight;

          if (payload.simple_language) {
            resetSpeechQueue();
            queueSpeech(text);
          }
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Streaming chat failed');
        }
      });

      if (!payload.simple_language && sentenceBuffer.trim()) {
        queueSpeech(sentenceBuffer);
      }

      if (fullAssistantText.trim()) {
        lastAssistantText = fullAssistantText.trim();
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

    if (voiceRecording) {
      stopVoiceRecording(true);
      return;
    }

    if (voiceProcessing) {
      sendAfterVoiceTranscription = true;
      return;
    }

    const value = chatInput.value.trim();
    if (!value) return;

    addBubble('user', value);
    chatInput.value = '';

    resetSpeechQueue();
    setThinkingIndicator(true);

    isGenerating = true;
    sendBtn.disabled = true;

    try {
      await streamAssistantReply({
        session_id: sessionId,
        message: value,
        language: state.selectedLang,
        age_range: AGE_RANGE_BY_KEY[state.selectedAge] || AGE_RANGE_BY_KEY.adult,
        personality: state.selectedPersona,
        simple_language: state.accessibilityPrefs.simpleLanguage,
        visual_descriptions: state.accessibilityPrefs.visualDescriptions,
        more_time: state.accessibilityPrefs.moreTime,
        room: state.currentRoom,
        artwork: state.currentArtwork
      });
    } catch (e) {
      console.error("Chat error:", e);
      setThinkingIndicator(false);
      addBubble('assistant', t('chat.connectionError'));
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      setThinkingIndicator(false);
    }
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

  function initSuggestionButtons() {
    const suggestionBtns = Array.from(document.querySelectorAll('.suggestion-btn'));

    suggestionBtns.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        // 1. Tell me about this artwork
        if (index === 0) {
          chatInput.value = btn.textContent.trim();
          handleSend();
          return;
        }

        // 2. Repeat
        if (index === 1) {
          if (!lastAssistantText.trim()) return;
          resetSpeechQueue();
          queueSpeech(lastAssistantText);
          return;
        }

        // 3. Go slower
        if (index === 2) {
          setSpeechSpeed('slow');

          // Optional: also ask the guide to continue more slowly/simply
          chatInput.value = btn.textContent.trim();
          handleSend();
        }
      });
    });
  }

  initSuggestionButtons();

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });
}

function applyContext(roomText, artworkText) {
  // Solo actualiza el header si los elementos existen
  
  // Store context
  state.currentRoom = roomText;
  state.currentArtwork = artworkText;

  // Update header
  const roomEl    = el('current-room');
  const artworkEl = el('current-artwork');
  if (roomEl)    roomEl.textContent    = t('app.room') + ': ' + roomText;
  if (artworkEl) artworkEl.textContent = t('app.artwork') + ': ' + (artworkText || t('context.notSet'));

  el('context-error').textContent = '';
  el('room-select').removeAttribute('aria-invalid');

  const msg = artworkText ? `${roomText} · ${artworkText}` : roomText;
  addBubble('user', msg);
  el('context-box').setAttribute('hidden', '');

  // Send context to LLM backend
  fetch("http://127.0.0.1:5002/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      room: roomText,
      artwork: artworkText
    })
  }).catch(e => console.warn("Could not send context to backend:", e));
}



  /* Legacy mic implementation disabled; superseded by the recorder above.
  let mediaRecorder;
  let audioChunks = [];

  async function startRecording() {
    try {
      console.log("🎤 intentando acceder al micro...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("✅ micro concedido", stream);
      mediaRecorder = new MediaRecorder(stream);
      

      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });

        // send to backend
        const formData = new FormData();
        formData.append('file', blob);
        formData.append('lang', selectedLang);

        const res = await fetch('http://127.0.0.1:5000/transcribe', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        el('chat-input').value = data.text;
      };

      mediaRecorder.start();
      

    } catch (err) {
      console.error("❌ error acceso micro:", err);
    }
  }

  function stopRecording() {
    mediaRecorder.stop();
  }

  let isRecording = false;

  micBtn.addEventListener('legacy-click-disabled', async () => {
    if (!isRecording) {
      await startRecording();
      micBtn.setAttribute('aria-pressed', 'true');
      isRecording = true;
    } else {
      stopRecording();
      micBtn.setAttribute('aria-pressed', 'false');
      isRecording = false;
    }
  }); 

  */
