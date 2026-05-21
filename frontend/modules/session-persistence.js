function getChatMessagesForStorage() {
  return qa('#chat-thread .msg-bubble').map((bubble) => ({
    role: bubble.dataset.role || 'assistant',
    text: getBubbleText(bubble),
    sourceText: bubble.dataset.originalText || getBubbleText(bubble),
    sourceLang: bubble.dataset.originalLang || bubble.dataset.messageLang || state.selectedLang || DEFAULT_LANGUAGE,
    lang: bubble.dataset.messageLang || state.selectedLang || DEFAULT_LANGUAGE
  })).filter((message) => message.text);
}

function saveGuiaSession() {
  try {
    localStorage.setItem(GUIA_SESSION_STORAGE_KEY, JSON.stringify({
      sessionId,
      selectedPersona: state.selectedPersona,
      selectedAge: state.selectedAge,
      selectedLang: state.selectedLang,
      currentRoom: state.currentRoom,
      currentArtwork: state.currentArtwork,
      privacyAccepted: state.privacyAccepted,
      chatStarted: state.chatStarted,
      showTutorialOnStart: state.showTutorialOnStart,
      accessibilityPrefs: state.accessibilityPrefs,
      chatMessages: getChatMessagesForStorage(),
      savedAt: new Date().toISOString()
    }));
  } catch (err) {
    console.warn('Could not save GuIA session:', err);
  }
}

function restoreStoredChatMessages() {
  const messages = Array.isArray(storedGuiaSession?.chatMessages)
    ? storedGuiaSession.chatMessages
    : [];
  if (!messages.length) return;

  const chatThread = el('chat-thread');
  if (!chatThread) return;

  chatThread.innerHTML = '';
  messages.forEach((message) => {
    addBubble(message.role, message.text, {
      sourceText: message.sourceText || message.text,
      sourceLang: message.sourceLang || message.lang || state.selectedLang,
      lang: message.lang || state.selectedLang
    });
  });
}

function restoreGuiaSessionUI() {
  if (!storedGuiaSession) return;

  if (state.selectedLang) {
    selectRadio(qa('#language-group [data-lang]'), q(`#language-group [data-lang="${state.selectedLang}"]`));
  }
  if (state.selectedPersona) {
    selectRadio(qa('[data-persona]'), q(`[data-persona="${state.selectedPersona}"]`));
  }
  if (state.selectedAge) {
    selectRadio(qa('[data-age]'), q(`[data-age="${state.selectedAge}"]`));
  }

  syncAccessibilityControls();
  applyAccessibilityPrefs();
  restoreStoredChatMessages();

  const roomEl = el('current-room');
  const artworkEl = el('current-artwork');
  if (roomEl && state.currentRoom) roomEl.textContent = t('app.room') + ': ' + state.currentRoom;
  if (artworkEl && state.currentArtwork) artworkEl.textContent = t('app.artwork') + ': ' + state.currentArtwork;

  if (state.privacyAccepted || state.chatStarted) {
    hideOnboarding();
  }
}

function restartGuiaSession() {
  localStorage.removeItem(GUIA_SESSION_STORAGE_KEY);

  state.selectedPersona = null;
  state.selectedAge = null;
  state.currentRoom = null;
  state.currentArtwork = null;
  state.privacyAccepted = false;
  state.chatStarted = false;
  state.showTutorialOnStart = false;
  state.deferredSpokenAudioChange = null;
  state.conversationTranslationRequestId = 0;
  state.chatGenerating = false;
  state.conversationTranslating = false;
  state.lastLocationLinkKey = null;
  state.accessibilityPrefs = {
    largeText: false,
    simpleLanguage: false,
    spokenAudio: false,
    moreTime: false,
    visualDescriptions: false
  };

  const chatThread = el('chat-thread');
  if (chatThread) {
    chatThread.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'msg-row assistant';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble assistant-bubble';
    bubble.dataset.role = 'assistant';
    bubble.dataset.i18nKey = 'chat.welcome';
    bubble.dataset.originalLang = 'ca';
    bubble.dataset.messageLang = state.selectedLang || DEFAULT_LANGUAGE;
    bubble.tabIndex = 0;
    setBubbleText(bubble, t('chat.welcome'), 'assistant');
    setBubbleSource(bubble, state.translations.ca?.chat?.welcome || t('chat.welcome'), 'ca');
    updateBubbleAccessibilityLabel(bubble, 'assistant');
    row.appendChild(bubble);
    chatThread.appendChild(row);
  }

  qa('[data-persona]').forEach((btn) => {
    btn.setAttribute('aria-checked', 'false');
  });
  qa('[data-age]').forEach((btn) => {
    btn.setAttribute('aria-checked', 'false');
  });

  const currentRoom = el('current-room');
  if (currentRoom) currentRoom.textContent = '';
  const currentArtwork = el('current-artwork');
  if (currentArtwork) currentArtwork.textContent = '';
  const consentCheckbox = el('privacy-consent');
  if (consentCheckbox) consentCheckbox.checked = false;

  syncAccessibilityControls();
  applyAccessibilityPrefs();
  applyAppTranslations();
  showOnboarding();
  window.saveGuiaSession?.();
}

window.addEventListener('beforeunload', () => {
  saveGuiaSession();
});
