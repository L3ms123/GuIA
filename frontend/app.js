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
}
