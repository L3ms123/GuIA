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
  })
    .then((res) => {
      if (!res.ok) throw new Error('Could not send context to backend');
      return window.guiaSendContextMessage?.(msg);
    })
    .catch((e) => console.warn('Could not send context to backend:', e));
}
