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

function parseRoomFloor(room) {
  const normalizedValue = normalizeLocationValue(room.id || room.label);
  const match = normalizedValue.match(/\bp(?:alau)?\s*([a-z0-9]+)/i);
  if (!match) return '';
  return /^\d+$/.test(match[1]) ? String(Number(match[1])) : match[1].toUpperCase();
}

function parseRoomNumbers(room) {
  const value = normalizeLocationValue(room.id || room.label);
  if (!value) return null;

  const fullMatch = value.match(/\bp(?:alau)?\s*([a-z0-9]+)[\s\-,:]*s(?:ala)?\s*([a-z0-9]+)\b/);
  if (fullMatch) {
    return { floor: fullMatch[1], room: fullMatch[2] };
  }

  const roomOnly = value.match(/\bs(?:ala)?\s*([a-z0-9]+)\b/);
  if (roomOnly) {
    return { room: roomOnly[1] };
  }

  const numberOnly = value.match(/\b(\d+)\b/);
  if (numberOnly) {
    return { room: numberOnly[1] };
  }

  return null;
}

function getRoomLabelText(room) {
  const parsed = parseRoomNumbers(room);
  if (!parsed) return room.label || room.id;

  const roomLabel = t('app.roomLabel', 'Room');
  return `${roomLabel} ${String(parsed.room).toUpperCase()}`;
}

function getRoomContextText(room) {
  if (!room) return '';
  return room.label || room.id || '';
}

function findLocationRoomById(roomId) {
  const normalizedRoom = normalizeLocationValue(roomId);
  return (state.locationData.rooms || []).find((room) => {
    return normalizeLocationValue(room.id) === normalizedRoom;
  });
}

function getRoomsByFloor() {
  return (state.locationData.rooms || []).reduce((groups, room) => {
    const floor = parseRoomFloor(room) || '0';
    if (!groups[floor]) groups[floor] = [];
    groups[floor].push(room);
    return groups;
  }, {});
}

function floorSortKey(floor) {
  const floorText = String(floor || '');
  const numberMatch = floorText.match(/\d+/);
  return numberMatch ? [0, Number(numberMatch[0]), floorText] : [1, 999, floorText];
}

function renderLocationSelects() {
  const floorSelect = el('floor-select');
  const roomSelect = el('room-select');
  if (!floorSelect || !roomSelect) return;

  const selectedFloor = floorSelect.value;
  const selectedRoom = roomSelect.value;
  const roomsByFloor = getRoomsByFloor();
  const floors = Object.keys(roomsByFloor).sort((a, b) => {
    const aKey = floorSortKey(a);
    const bKey = floorSortKey(b);
    return aKey[0] - bKey[0] || aKey[1] - bKey[1] || aKey[2].localeCompare(bKey[2]);
  });

  floorSelect.innerHTML = '';
  floorSelect.appendChild(new Option(t('context.selectFloor', 'Select a floor'), ''));
  floors.forEach((floor) => {
    const floorLabel = `${t('context.floorOptionLabel', 'Floor')} ${floor}`;
    floorSelect.appendChild(new Option(floorLabel, floor));
  });

  let activeFloor = selectedFloor;
  if (!activeFloor && selectedRoom) {
    const currentRoom = (state.locationData.rooms || []).find((room) => room.id === selectedRoom);
    if (currentRoom) {
      activeFloor = getFloorForRoom(currentRoom);
    }
  }

  if (activeFloor && floors.includes(activeFloor)) {
    floorSelect.value = activeFloor;
  }

  renderRoomSelect(roomsByFloor);
  renderArtworkSelect();
  renderContextSuggestion();
}

function renderRoomSelect(roomsByFloor) {
  const floorSelect = el('floor-select');
  const roomSelect = el('room-select');
  if (!floorSelect || !roomSelect) return;

  const selectedRoom = roomSelect.value;
  const rooms = roomsByFloor[floorSelect.value] || [];

  roomSelect.innerHTML = '';
  roomSelect.appendChild(new Option(t('context.selectRoom', 'Select a room'), ''));
  roomSelect.disabled = rooms.length === 0;

  rooms.forEach((room) => {
    roomSelect.appendChild(new Option(getRoomLabelText(room), room.id));
  });

  if (rooms.some((room) => room.id === selectedRoom)) {
    roomSelect.value = selectedRoom;
  }
}

function getFloorForRoom(room) {
  return parseRoomFloor(room) || '0';
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

  const roomLabel = getRoomLabelText(firstRoom);
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

function applyLocationPayload(locationPayload, source = 'url') {
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
    const floorSelect = el('floor-select');
    const floor = getFloorForRoom(room);
    if (floorSelect && floor) {
      floorSelect.value = floor;
    }

    renderRoomSelect(getRoomsByFloor());
    roomSelect.value = room.id;
    roomSelect.removeAttribute('aria-invalid');
  }

  renderArtworkSelect();

  if (artworkSelect && artwork) {
    artworkSelect.value = artwork.id || artwork.title;
  }

  state.lastLocationLinkKey = locationKey;
  applyContext(roomText, artworkText, source);
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