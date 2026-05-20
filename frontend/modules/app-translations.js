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
