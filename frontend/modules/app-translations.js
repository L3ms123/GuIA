// App translations

function applyAppTranslations() {
  if (!state.translations[state.selectedLang]) return;
  document.documentElement.lang = state.selectedLang || 'ca';

  qa('.speed-btn').forEach((btn, i) => {
    btn.textContent = t(`audio.${AUDIO_SPEED_KEYS[i]}`);
  });

  setText(q('.audio-label'), t('audio.volume', 'Volume'));
  setText(el('audio-settings-text'), t('audio.panelButton', 'Audio'));

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
  if (firstAssistantBubble?.dataset.i18nKey === 'chat.welcome') {
    setBubbleText(firstAssistantBubble, t('chat.welcome'), 'assistant');
    firstAssistantBubble.dataset.messageLang = state.selectedLang;
    setBubbleSource(firstAssistantBubble, state.translations.ca?.chat?.welcome || t('chat.welcome'), 'ca');
    updateBubbleAccessibilityLabel(firstAssistantBubble, 'assistant');
  }

  const suggestions = t('chat.suggestions');
  qa('.suggestion-btn').forEach((btn, i) => {
    if (suggestions[i]) btn.textContent = suggestions[i];
  });

  setText(q('.brand-title'), t('app.title'));

  const appTitle = el('app-title');
  if (appTitle) {
    appTitle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">settings</span>';
    appTitle.setAttribute('aria-label', t('app.openSettings', 'Open guide settings'));
    appTitle.setAttribute('title', t('app.openSettings', 'Open guide settings'));
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
  window.guiaApplyTutorialTranslations?.();
}

function setChatTranslationStatus(message = '') {
  const status = el('chat-translation-status');
  if (!status) return;

  if (!message) {
    status.setAttribute('hidden', '');
    status.textContent = '';
    return;
  }

  status.textContent = message;
  status.hidden = false;
}

function setLanguageOptionsDisabled(disabled) {
  qa('#language-group [data-lang]').forEach((button) => {
    button.disabled = disabled;
    button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  });
}

function collectConversationTranslationItems(bubbles) {
  const maxItems = 25;
  const maxChars = 12000;
  let usedChars = 0;
  const items = [];

  for (const [index, bubble] of bubbles.entries()) {
    const visibleText = getBubbleText(bubble);
    const sourceText = (bubble.dataset.originalText || visibleText).trim();
    const sourceLang = bubble.dataset.originalLang || bubble.dataset.messageLang || state.selectedLang;

    if (!sourceText || bubble.dataset.i18nKey || bubble.dataset.messageLang === state.selectedLang) {
      continue;
    }

    if (sourceLang === state.selectedLang) {
      setBubbleText(bubble, sourceText, bubble.classList.contains('user-bubble') ? 'user' : 'assistant');
      bubble.dataset.messageLang = state.selectedLang;
      updateBubbleAccessibilityLabel(bubble, bubble.classList.contains('user-bubble') ? 'user' : 'assistant');
      continue;
    }

    const nextChars = usedChars + sourceText.length;
    if (items.length >= maxItems || nextChars > maxChars) {
      break;
    }

    usedChars = nextChars;
    items.push({
      index,
      role: bubble.classList.contains('user-bubble') ? 'user' : 'assistant',
      source_language: sourceLang,
      text: sourceText
    });
  }

  return items;
}

function updateReplayFromLastAssistantBubble(bubbles = qa('#chat-thread .msg-bubble')) {
  const lastAssistantBubble = [...bubbles].reverse().find((bubble) => bubble.classList.contains('assistant-bubble'));
  const text = getBubbleText(lastAssistantBubble);
  if (text) {
    window.guiaSetLastAssistantText?.(text);
    announce(t('audio.languageChanged', 'Audio language changed.'));
  }
}

async function translateExistingConversation(previousLang) {
  if (!state.chatStarted || !previousLang || previousLang === state.selectedLang) {
    window.saveGuiaSession?.();
    return;
  }

  const requestId = state.conversationTranslationRequestId + 1;
  state.conversationTranslationRequestId = requestId;
  const bubbles = qa('#chat-thread .msg-bubble');
  const items = collectConversationTranslationItems(bubbles);

  if (!items.length) {
    updateReplayFromLastAssistantBubble(bubbles);
    return;
  }

  const translatingText = t('chat.translatingConversation', 'Translating the conversation.');
  state.conversationTranslating = true;
  setLanguageOptionsDisabled(true);
  bubbles.forEach((bubble) => bubble.setAttribute('aria-busy', 'true'));
  setChatTranslationStatus(translatingText);
  announce(translatingText);

  try {
    const res = await fetch(API_ENDPOINTS.translateConversation, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_language: previousLang,
        to_language: state.selectedLang,
        items
      })
    });

    if (requestId !== state.conversationTranslationRequestId) return;

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const data = await res.json();
    const translations = Array.isArray(data.translations) ? data.translations : [];

    translations.forEach((item) => {
      const bubble = bubbles[item.index];
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!bubble || !text) return;

      setBubbleText(bubble, text, item.role === 'user' ? 'user' : 'assistant');
      bubble.dataset.messageLang = state.selectedLang;
      updateBubbleAccessibilityLabel(bubble, item.role === 'user' ? 'user' : 'assistant');
    });

    updateReplayFromLastAssistantBubble(bubbles);

    const translatedText = t('chat.conversationTranslated', 'Conversation translated.');
    setChatTranslationStatus(translatedText);
    announce(translatedText);
    window.setTimeout(() => {
      if (requestId === state.conversationTranslationRequestId) setChatTranslationStatus('');
    }, 2500);
  } catch (err) {
    console.error('Conversation translation failed:', err);
    const failedText = t('chat.conversationTranslationFailed', 'Conversation translation failed.');
    setChatTranslationStatus(failedText);
    announce(failedText);
  } finally {
    if (requestId === state.conversationTranslationRequestId) {
      bubbles.forEach((bubble) => bubble.removeAttribute('aria-busy'));
      state.conversationTranslating = false;
      setLanguageOptionsDisabled(false);
      window.saveGuiaSession?.();
    }
  }
}

async function applyLanguageChange(previousLang = null) {
  if (state.selectedLang !== 'ca' || !translationsLoaded) {
    await preloadTranslations();
  }

  applyOnboardingTranslations();
  applyAppTranslations();
  window.guiaResetSpeechQueue?.();
  await translateExistingConversation(previousLang);
  updateOnboardingButtons();
  window.guiaResetSpeechQueue?.();
}
