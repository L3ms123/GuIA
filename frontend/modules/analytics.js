// Session analytics (testing mode).
//
// Sends metadata-only usage events to the backend /analytics endpoint. The
// backend silently discards everything unless GUIA_ANALYTICS_ENABLED is set, so
// this module always sends and never gates on its own. No question/answer text
// is ever included here.

const SCHEMA_VERSION = 1;

// New per page-load id. NOT persisted, so each visit is a distinct unit. The
// persistent `sessionId` (from state.js) groups returning visitors.
const visitId = crypto.randomUUID();

// Was there a stored session before this load? (returning visitor)
const returningVisitor = !!storedGuiaSession?.sessionId;

const analyticsState = {
  startMs: performance.now(),
  ended: false,
  orderIndex: -1,
  currentLocationKey: '∅|',
  locationQuestionCounts: {},
  questionsTotal: 0,
  locationsTotal: 0,
  lastSendVia: 'text'
};

const INACTIVITY_MS = 90 * 1000;
let inactivityTimer = null;

function track(eventType, payload = {}, { beacon = false } = {}) {
  try {
    const body = JSON.stringify({
      schema_version: SCHEMA_VERSION,
      event: eventType,
      visitId,
      sessionId,
      clientTs: new Date().toISOString(),
      ...payload
    });

    if (beacon && navigator.sendBeacon) {
      // text/plain avoids a CORS preflight; the backend parses the raw body.
      navigator.sendBeacon(API_ENDPOINTS.analytics, new Blob([body], { type: 'text/plain' }));
      return;
    }

    fetch(API_ENDPOINTS.analytics, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      keepalive: true
    }).catch(() => {});
  } catch (err) {
    // Analytics must never break the app.
  }
}

function locationKeyFrom(room, artwork) {
  return `${room || '∅'}|${artwork || ''}`;
}

function currentLocationKey() {
  return locationKeyFrom(state.currentRoom, state.currentArtwork);
}

function endSession(reason) {
  if (analyticsState.ended) return;
  analyticsState.ended = true;
  track('session_end', {
    reason,
    phase: state.chatStarted ? 'chat' : 'onboarding',
    durationMs: Math.round(performance.now() - analyticsState.startMs),
    questionsTotal: analyticsState.questionsTotal,
    locationsTotal: analyticsState.locationsTotal
  }, { beacon: reason !== 'restart' });
}

function resetInactivityTimer() {
  if (analyticsState.ended) return;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => endSession('inactivity'), INACTIVITY_MS);
}

// Public counters used by chat.js for question/answer events.
function nextQuestionIndexForLocation() {
  const key = currentLocationKey();
  analyticsState.locationQuestionCounts[key] = (analyticsState.locationQuestionCounts[key] || 0) + 1;
  analyticsState.questionsTotal += 1;
  resetInactivityTimer();
  return {
    locationKey: key,
    questionIndexInLocation: analyticsState.locationQuestionCounts[key]
  };
}

function recordLocationVisit(detail = {}) {
  analyticsState.orderIndex += 1;
  analyticsState.locationsTotal += 1;
  analyticsState.currentLocationKey = currentLocationKey();
  resetInactivityTimer();
  track('location_visited', {
    roomId: state.currentRoom || null,
    artworkId: state.currentArtwork || null,
    locationSource: detail.source || 'unknown',
    orderIndex: analyticsState.orderIndex
  });
}

function initAnalytics() {
  track('session_start', {
    phase: state.chatStarted ? 'chat' : 'onboarding',
    lang: state.selectedLang || DEFAULT_LANGUAGE,
    returningVisitor
  });

  document.addEventListener('guia:location-selected', (event) => recordLocationVisit(event.detail || {}));

  ['click', 'keydown', 'scroll', 'touchstart'].forEach((type) => {
    document.addEventListener(type, resetInactivityTimer, { passive: true });
  });

  resetInactivityTimer();
}

// Expose a small API for the other modules.
window.guiaTrack = track;
window.guiaAnalytics = {
  visitId,
  state: analyticsState,
  nextQuestionIndexForLocation,
  endSession,
  resetInactivityTimer,
  setLastSendVia(via) {
    analyticsState.lastSendVia = via || 'text';
  }
};

document.addEventListener('DOMContentLoaded', initAnalytics);
