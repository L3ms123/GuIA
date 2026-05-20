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
