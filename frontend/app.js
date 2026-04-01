// ─── State ────────────────────────────────────────────────────────────────────
let selectedPersona = null;
let selectedAge     = null;
let selectedLang    = null; 
let translations    = {};
let currentContext  = { room: '', artwork: '' };
let conversationHistory = [];
let isSending = false;

// New: prompt selection and model access now go through the Python backend.
const BACKEND_CHAT_URL = 'http://127.0.0.1:8000/api/chat';
const BACKEND_CHAT_STREAM_URL = 'http://127.0.0.1:8000/api/chat/stream';

const BACKEND_ERRORS = {
  en: 'GuIA could not reach the backend service. Make sure the Python backend is running.',
  es: 'GuIA no ha podido contactar con el backend. Asegurate de que el backend de Python este en ejecucion.',
  ca: "GuIA no ha pogut contactar amb el backend. Assegura't que el backend de Python estigui en execucio."
};

// ─── i18n ─────────────────────────────────────────────────────────────────────

function t(key) {
  const lang = translations[selectedLang] || translations['ca'] || {};
  return key.split('.').reduce((obj, k) => (obj ? obj[k] : undefined), lang) ?? key;
}

function applyOnboardingTranslations() {
  if (!translations[selectedLang]) return;

  // panel
  el('onboarding-eyebrow').textContent = t('onboarding.eyebrow');
  el('onboarding-title').textContent = t('onboarding.title');
  el('onboarding-desc').textContent  = t('onboarding.description');
  el('onboarding-hint').textContent  = t('onboarding.hint');

  // Section labels — addressed by ID on each <h2>
  el('label-language').textContent    = t('onboarding.language');
  el('label-personality').textContent = t('onboarding.personality');
  el('label-visitor').textContent     = t('onboarding.visitor');

  // Personas
  ['artist', 'storyteller', 'explorer', 'scholar'].forEach((key) => {
    const btn = document.querySelector(`[data-persona="${key}"]`);
    if (!btn) return;
    btn.querySelector('.card-title').textContent    = t(`personas.${key}.title`);
    btn.querySelector('.card-subtitle').textContent = t(`personas.${key}.subtitle`);
  });

  // Age chips
  ['child', 'teen', 'adult', 'senior'].forEach((key) => {
      const btn = document.querySelector(`[data-age="${key}"]`);
      if (!btn) return;
      const sub = btn.querySelector('.card-subtitle');
      for (const node of btn.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          node.textContent = t(`ages.${key}.title`) + ' ';
          break;
        }
      }
      if (sub) sub.textContent = t(`ages.${key}.subtitle`);
    });
  
  // Age hint
  el('age-hint').textContent = t('ageHint');
 

  // Start button — preserve disabled state, only change text
  const startBtn = el('onboarding-start');
  startBtn.textContent = t('onboarding.start');
  startBtn.disabled    = !(selectedLang && selectedPersona);
}

// Main page
function applyAppTranslations() {
  if (!translations[selectedLang]) return;

  // Botones de velocidad
  const speedBtns = Array.from(document.querySelectorAll('.speed-btn'));
  const speedKeys = ['slow', 'normal', 'fast'];
  speedBtns.forEach((btn, i) => {
    btn.textContent = t(`audio.${speedKeys[i]}`);
  });

  // Mensaje de bienvenida en el chat
  const firstBubble = document.querySelector('.assistant-bubble');
  if (firstBubble) firstBubble.textContent = t('chat.welcome');

  // Sugerencias
  const suggBtns = Array.from(document.querySelectorAll('.suggestion-btn'));
  const suggestions = t('chat.suggestions');
  suggBtns.forEach((btn, i) => {
    if (suggestions[i]) btn.textContent = suggestions[i];
  });

  // Botón "Where am I?"
  el('where-am-i-btn').textContent = t('app.whereAmI');

  /// Título principal
  const appTitle = el('app-title');
  if (appTitle) appTitle.textContent = t('app.title');

  el('choose-location').textContent = t('app.chooseLocation');
  el('room').textContent = t('app.room');
  el('artwork').textContent = t('app.artwork');

  // Opciones del select de sala
  const roomSelect = el('room-select');
  if (roomSelect) {
    roomSelect.options[0].text = t('context.selectRoom');
    roomSelect.options[1].text = t('context.room1');
    roomSelect.options[2].text = t('context.room2');
    roomSelect.options[3].text = t('context.room3');
  }

  // Opciones del select de obra
  const artworkSelect = el('artwork-select');
  if (artworkSelect) {
    artworkSelect.options[0].text = t('context.selectArtwork');
    artworkSelect.options[1].text = t('context.portrait');
    artworkSelect.options[2].text = t('context.annunciation');
    artworkSelect.options[3].text = t('context.lastSupper');
  }

  // Context suggestion
  document.querySelector('.context-suggestion').firstChild.textContent = t('app.contextSuggestion') + ' ';
  el('confirm-suggestion-btn').textContent = t('app.confirmSuggestion');

  // Footer
  document.querySelector('.helper-text').textContent = t('chat.helper');
  el('chat-input').placeholder = t('chat.placeholder');
  el('send-btn').textContent   = t('chat.send');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function el(id) {
  return document.getElementById(id);
}

function selectRadio(buttons, clicked) {
  buttons.forEach((b) =>
    b.setAttribute('aria-checked', b === clicked ? 'true' : 'false')
  );
}

function addBubble(role, text) {
  const chatThread = el('chat-thread');
  const row        = document.createElement('div');
  row.className    = `msg-row ${role}`;
  const bubble     = document.createElement('div');
  bubble.className = `msg-bubble ${role === 'user' ? 'user-bubble' : 'assistant-bubble'}`;
  bubble.textContent = text;
  row.appendChild(bubble);
  chatThread.appendChild(row);
  chatThread.scrollTop = chatThread.scrollHeight;
  return bubble;
}

function setTyping(isVisible) {
  const indicator = el('typing-indicator');
  if (!indicator) return;
  indicator.style.display = isVisible ? 'inline-flex' : 'none';
  indicator.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
}

function getBackendErrorMessage() {
  return BACKEND_ERRORS[selectedLang] || BACKEND_ERRORS.ca;
}

// New: send the selected persona, language, age, and museum context to the backend.
async function requestAssistantReply(message) {
  const response = await fetch(BACKEND_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      persona: selectedPersona,
      age: selectedAge,
      language: selectedLang,
      context: currentContext,
      history: conversationHistory
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.reply) {
    throw new Error('Empty backend response.');
  }

  return payload.reply;
}

// New: read streamed chunks from the backend so the assistant writes progressively.
async function streamAssistantReply(message, bubble) {
  const response = await fetch(BACKEND_CHAT_STREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      persona: selectedPersona,
      age: selectedAge,
      language: selectedLang,
      context: currentContext,
      history: conversationHistory
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP ${response.status}`);
  }

  if (!response.body) {
    return requestAssistantReply(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let hasStarted = false;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let lineBreak = buffer.indexOf('\n');
    while (lineBreak !== -1) {
      const line = buffer.slice(0, lineBreak).trim();
      buffer = buffer.slice(lineBreak + 1);

      if (line) {
        const event = JSON.parse(line);

        if (event.type === 'chunk') {
          reply += event.text || '';
          bubble.textContent = reply;
          if (!hasStarted) {
            hasStarted = true;
            setTyping(false);
          }
        } else if (event.type === 'error') {
          throw new Error(event.text || getBackendErrorMessage());
        }
      }

      lineBreak = buffer.indexOf('\n');
    }

    if (done) break;
  }

  if (!reply) {
    throw new Error('Empty backend response.');
  }

  return reply;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function loadTranslations() {
  try {
    const res    = await fetch('translations.json');
    translations = await res.json();
  } catch (e) {
    console.error('translations.json not found — serving without i18n', e);
    translations = {};
  }

  // Lee el idioma por defecto del aria-checked="true" en el HTML
  const preChecked = document.querySelector('#language-group [aria-checked="true"]');
  if (preChecked) selectedLang = preChecked.dataset.lang;

  applyOnboardingTranslations();
  initLanguageSelector();
  initPersonaButtons();
  initAgeButtons();
  initStartButton();
  initApp();
}

document.addEventListener('DOMContentLoaded', loadTranslations);

// ─── Onboarding ───────────────────────────────────────────────────────────────

function initLanguageSelector() {
  const btns = Array.from(document.querySelectorAll('#language-group [data-lang]'));

  // Set aria-checked to match default selectedLang
  btns.forEach((b) =>
    b.setAttribute('aria-checked', b.dataset.lang === selectedLang ? 'true' : 'false')
  );

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedLang = btn.dataset.lang;
      selectRadio(btns, btn);
      applyOnboardingTranslations();
    });
  });
}

function initPersonaButtons() {
  const btns = Array.from(document.querySelectorAll('[data-persona]'));
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPersona = btn.dataset.persona;
      selectRadio(btns, btn);
      // Re-run to update start button disabled state
      el('onboarding-start').disabled = false;
    });
  });
}

function initAgeButtons() {
  const btns = Array.from(document.querySelectorAll('[data-age]'));
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (selectedAge === btn.dataset.age) {
        selectedAge = null;
        btn.setAttribute('aria-checked', 'false');
      } else {
        selectedAge = btn.dataset.age;
        selectRadio(btns, btn);
      }
    });
  });
}

function initStartButton() {
  el('onboarding-start').addEventListener('click', () => {
    el('onboarding').style.display = 'none';
    document.body.dataset.mode = selectedAge === 'senior' ? 'senior' : 'regular';
    applyAppTranslations();
  });
}

// ─── Main app ─────────────────────────────────────────────────────────────────

function initApp() {
  setTyping(false);

  // Speed radios
  const speedBtns = Array.from(document.querySelectorAll('.speed-btn'));
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      speedBtns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    });
  });

  // Mute
  const muteBtn = el('mute-btn');
  muteBtn.addEventListener('click', () => {
    const on = muteBtn.getAttribute('aria-pressed') === 'true';
    muteBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    muteBtn.textContent = on ? '🔈' : '🔇';
  });

  // Mic
  const micBtn = el('mic-btn');
  micBtn.addEventListener('click', () => {
    const on = micBtn.getAttribute('aria-pressed') === 'true';
    micBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
  });

  // Where am I panel
  el('where-am-i-btn').addEventListener('click', () => {
    const box = el('context-box');
    box.hasAttribute('hidden') ? box.removeAttribute('hidden') : box.setAttribute('hidden', '');
  });

  // Set context
  const roomSelect    = el('room-select');
  const artworkSelect = el('artwork-select');

  el('set-context-btn').addEventListener('click', () => {
    if (!roomSelect.value) {
      el('context-error').textContent = t('app.contextError');
      roomSelect.setAttribute('aria-invalid', 'true');
      roomSelect.focus();
      return;
    }
    const roomText    = roomSelect.options[roomSelect.selectedIndex].text;
    const artworkText = artworkSelect.value          // ← comprueba el value
      ? artworkSelect.options[artworkSelect.selectedIndex].text
      : '';

    applyContext(roomText, artworkText);
  });

  el('confirm-suggestion-btn').addEventListener('click', () => {
    applyContext(t('context.room2'), t('context.portrait'));
  });

  // Chat
  const chatThread = el('chat-thread');
  const chatInput  = el('chat-input');

  async function handleSend() {
    const value = chatInput.value.trim();
    if (!value || isSending) return;

    addBubble('user', value);
    const assistantBubble = addBubble('assistant', '');
    chatInput.value = '';
    isSending = true;
    el('send-btn').disabled = true;
    setTyping(true);

    try {
      // New: the assistant reply now streams from the backend instead of appearing all at once.
      const reply = await streamAssistantReply(value, assistantBubble);
      conversationHistory.push({ role: 'user', text: value });
      conversationHistory.push({ role: 'assistant', text: reply });
    } catch (error) {
      console.error('Backend request failed:', error);
      assistantBubble.textContent = error.message || getBackendErrorMessage();
    } finally {
      isSending = false;
      el('send-btn').disabled = false;
      setTyping(false);
    }
  }

  el('send-btn').addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });
}

function applyContext(roomText, artworkText) {
  // New: keep the selected museum context so the backend can adapt the prompt.
  currentContext = { room: roomText, artwork: artworkText };

  // Solo actualiza el header si los elementos existen
  const roomEl    = el('current-room');
  const artworkEl = el('current-artwork');
  if (roomEl)    roomEl.textContent    = t('app.room') + ': ' + roomText;
  if (artworkEl) artworkEl.textContent = t('app.artwork') + ': ' + (artworkText || t('context.notSet'));

  el('context-error').textContent = '';
  el('room-select').removeAttribute('aria-invalid');

  const msg = artworkText ? `${roomText} · ${artworkText}` : roomText;
  addBubble('user', msg);
  el('context-box').setAttribute('hidden', '');
}
