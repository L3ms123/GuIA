// Apply context

function applyContext(roomText, artworkText) {
  if (state.chatGenerating || state.conversationTranslating) {
    const error = el('context-error');
    if (error) error.textContent = t('app.contextBusy', 'Wait until the current response finishes before changing location.');
    announce(t('app.contextBusy', 'Wait until the current response finishes before changing location.'));
    return;
  }

  state.currentRoom = roomText;
  state.currentArtwork = artworkText;

  const roomEl = el('current-room');
  const artworkEl = el('current-artwork');
  if (roomEl) roomEl.textContent = t('app.room') + ': ' + roomText;
  if (artworkEl) artworkEl.textContent = t('app.artwork') + ': ' + (artworkText || t('context.notSet'));

  el('context-error').textContent = '';
  el('room-select').removeAttribute('aria-invalid');

  const msg = artworkText ? `${roomText} \u00b7 ${artworkText}` : roomText;
  el('manual-location-panel')?.setAttribute('hidden', '');
  el('manual-location-btn')?.setAttribute('aria-expanded', 'false');
  document.body.removeAttribute('data-location-panel-open');
  el('location-panel-btn')?.setAttribute('aria-expanded', 'false');
  el('chat-input')?.focus();

  fetch(API_ENDPOINTS.context, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      room: roomText,
      artwork: artworkText
    })
  })
    .then((res) => {
      if (!res.ok) throw new Error('Could not send context to backend');
      addBubble('user', msg, { sourceText: msg, sourceLang: state.selectedLang });
      return window.guiaSendContextMessage?.(msg);
    })
    .catch((e) => {
      console.warn('Could not send context to backend:', e);
      const error = el('context-error');
      if (error) error.textContent = t('app.contextSendError', 'Could not update your location. Please try again.');
      document.body.toggleAttribute('data-location-panel-open', true);
      el('location-panel-btn')?.setAttribute('aria-expanded', 'true');
    });
}
