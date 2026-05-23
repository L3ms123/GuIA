// Boot

async function loadTranslations() {
  const translationsPromise = preloadTranslations();
  const locationsPromise = loadLocations();

  state.selectedLang = state.selectedLang || DEFAULT_LANGUAGE;
  state.selectedPersona = state.selectedPersona || DEFAULT_PERSONA;
  selectRadio(qa('#language-group [data-lang]'), q(`#language-group [data-lang="${state.selectedLang}"]`));
  selectRadio(qa('[data-persona]'), q(`[data-persona="${state.selectedPersona}"]`));

  initLanguageSelector();
  initPersonaButtons();
  initAgeButtons();
  initOnboardingFocusTrap();
  initOnboardingKeyboardSupport();

  bindOnboardingFlow();

  initAppTitleButton();
  initApp();
  restoreGuiaSessionUI();
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
  renderLocationSelects();
  initLocationLinkHandler();
  applyLocationFromURL();
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
      if (state.chatGenerating || state.conversationTranslating) {
        announce(t('chat.languageChangeBusy', 'Wait until the current response or translation finishes before changing language.'));
        return;
      }
      const previousLang = state.selectedLang;
      state.selectedLang = btn.dataset.lang;
      selectRadio(btns, btn);
      await applyLanguageChange(previousLang);
      window.saveGuiaSession?.();
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
      window.saveGuiaSession?.();
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
      window.saveGuiaSession?.();
    });
  });
}

// Main app

function initApp() {
  const audio = initAudioControls();
  const voice = initVoiceInput(audio);

  warmTranscriptionModel();
  initTutorial();
  initInitialWelcomeSpeech(audio);
  initContextPanel();
  initChat(audio, voice);
}

function warmTranscriptionModel() {
  fetch(API_ENDPOINTS.transcribeWarmup, { method: 'POST' }).catch((err) => {
    console.debug('Transcription warm-up skipped:', err);
  });
}

