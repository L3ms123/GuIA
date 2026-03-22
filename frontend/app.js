// ─── State ────────────────────────────────────────────────────────────────────
let selectedPersona = null;
let selectedAge     = null;
let selectedLang    = null; // default: català
let translations    = {};

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function el(id) {
  return document.getElementById(id);
}

function selectRadio(buttons, clicked) {
  buttons.forEach((b) =>
    b.setAttribute('aria-checked', b === clicked ? 'true' : 'false')
  );
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
  });
}

// ─── Main app ─────────────────────────────────────────────────────────────────

function initApp() {
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
    applyContext(
      roomSelect.options[roomSelect.selectedIndex].text,
      artworkSelect.options[artworkSelect.selectedIndex]?.text || ''
    );
  });

  el('confirm-suggestion-btn').addEventListener('click', () => {
    applyContext(t('context.room2'), t('context.portrait'));
  });

  // Chat
  const chatThread = el('chat-thread');
  const chatInput  = el('chat-input');

  function addBubble(role, text) {
    const row    = document.createElement('div');
    row.className = `msg-row ${role}`;
    const bubble  = document.createElement('div');
    bubble.className = `msg-bubble ${role === 'user' ? 'user-bubble' : 'assistant-bubble'}`;
    bubble.textContent = text;
    row.appendChild(bubble);
    chatThread.appendChild(row);
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function handleSend() {
    const value = chatInput.value.trim();
    if (!value) return;
    addBubble('user', value);
    chatInput.value = '';
    setTimeout(() => addBubble('assistant', 'This is where GuIA would respond.'), 500);
  }

  el('send-btn').addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });
}

function applyContext(roomText, artworkText) {
  if (roomText)    el('current-room').textContent    = t('app.room') + ': ' + roomText;
  if (artworkText) el('current-artwork').textContent = t('app.artwork') + ': ' + artworkText;
  el('context-error').textContent = '';
  el('room-select').removeAttribute('aria-invalid');
}