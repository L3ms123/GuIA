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

function parseLocationLinkParams(source = window.location.href) {
  let url;
  const sourceText = String(source || '').trim().replaceAll('&amp;', '&');

  function paramsFromSearchParams(params) {
    const room = params.get('room') || params.get('roomId');
    const artwork = params.get('artwork') || params.get('artworkId');

    if (!room && !artwork) return null;
    return { room, artwork };
  }

  function paramsFromQueryText(queryText) {
    const cleanedQuery = String(queryText || '').replace(/^[?#]/, '');
    if (!cleanedQuery) return null;

    return paramsFromSearchParams(new URLSearchParams(cleanedQuery));
  }

  try {
    url = new URL(sourceText, window.location.href);
  } catch (err) {
    return paramsFromQueryText(sourceText);
  }

  const hash = url.hash.replace(/^#/, '');
  const hashQuery = hash.startsWith('location?')
    ? hash.slice('location?'.length)
    : hash.startsWith('?')
    ? hash.slice(1)
    : '';
  const directPayload = paramsFromQueryText(hashQuery || url.search);
  if (directPayload) return directPayload;

  try {
    const decodedText = decodeURIComponent(sourceText);
    const nestedQuery = decodedText.match(/[?#](?:location\?)?([^#]*)$/)?.[1];
    return nestedQuery ? paramsFromQueryText(nestedQuery) : null;
  } catch (err) {
    return null;
  }
}

function normalizeLocationValue(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function findLocationRoom(roomValue) {
  const normalizedRoom = normalizeLocationValue(roomValue);
  return (state.locationData.rooms || []).find((room) => {
    return normalizeLocationValue(room.id) === normalizedRoom ||
      normalizeLocationValue(room.label) === normalizedRoom;
  });
}

function findLocationArtwork(room, artworkValue) {
  if (!room || !artworkValue) return null;

  const normalizedArtwork = normalizeLocationValue(artworkValue);
  return (room.artworks || []).find((artwork) => {
    return normalizeLocationValue(artwork.id || artwork.title) === normalizedArtwork ||
      normalizeLocationValue(artwork.title) === normalizedArtwork;
  });
}

function applyLocationPayload(locationPayload) {
  if (!locationPayload?.room) return false;

  const locationKey = JSON.stringify(locationPayload);
  if (state.lastLocationLinkKey === locationKey) return true;

  const room = findLocationRoom(locationPayload.room);
  const contextError = el('context-error');

  if (!room) {
    if (contextError) {
      contextError.textContent = t('app.roomNotFound', 'Room not found');
    }
    return false;
  }

  const roomSelect = el('room-select');
  const artworkSelect = el('artwork-select');
  const roomText = room.label || room.id;
  const artwork = findLocationArtwork(room, locationPayload.artwork);
  if (locationPayload.artwork && !artwork) {
    if (contextError) {
      contextError.textContent = t('app.invalidQR', 'Invalid QR code');
    }
    return false;
  }
  const artworkText = artwork ? artwork.title : '';

  if (roomSelect) {
    roomSelect.value = room.id;
    roomSelect.removeAttribute('aria-invalid');
  }

  renderArtworkSelect();

  if (artworkSelect && artwork) {
    artworkSelect.value = artwork.id || artwork.title;
  }

  state.lastLocationLinkKey = locationKey;
  applyContext(roomText, artworkText);
  return true;
}

function applyLocationFromURL() {
  const locationPayload = parseLocationLinkParams(window.location.href) ||
    parseLocationLinkParams(document.referrer);
  if (!locationPayload) return false;

  return applyLocationPayload(locationPayload);
}

function applyLocationFromLink(linkText) {
  const locationPayload = parseLocationLinkParams(linkText);
  if (!locationPayload) return false;

  return applyLocationPayload(locationPayload);
}

function initLocationLinkHandler() {
  window.addEventListener('hashchange', () => applyLocationFromURL());
  window.addEventListener('popstate', () => applyLocationFromURL());
}
