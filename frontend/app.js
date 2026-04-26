// ─── State ────────────────────────────────────────────────────────────────────
let selectedPersona = null;
let selectedAge     = null;
let selectedLang    = null; 
let translations    = {};
window.USE_KOKORO = true;

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
  if (!micBtn) return;

  let mediaRecorder;
  let audioChunks = [];

  async function startRecording() {
    try {
      console.log("🎤 intentando acceder al micro...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("✅ micro concedido", stream);
      mediaRecorder = new MediaRecorder(stream);
      

      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });

        // send to backend
        const formData = new FormData();
        formData.append('file', blob);
        formData.append('lang', selectedLang);

        const res = await fetch('http://127.0.0.1:5000/transcribe', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        el('chat-input').value = data.text;
      };

      mediaRecorder.start();
      

    } catch (err) {
      console.error("❌ error acceso micro:", err);
    }
  }

  function stopRecording() {
    mediaRecorder.stop();
  }

  let isRecording = false;

  micBtn.addEventListener('click', async () => {
    if (!isRecording) {
      await startRecording();
      micBtn.setAttribute('aria-pressed', 'true');
      isRecording = true;
    } else {
      stopRecording();
      micBtn.setAttribute('aria-pressed', 'false');
      isRecording = false;
    }
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
  function speakBrowser(text, lang = selectedLang, persona = "adult") {
    const utterance = new SpeechSynthesisUtterance(text);

    const langMap = {
      en: "en-US",
      es: "es-ES",
      ca: "ca-ES"
    };

    utterance.lang = langMap[lang];

    const config = {
      child:  { pitch: 1.6, rate: 1.05 },
      teen:   { pitch: 1.2, rate: 1.0 },
      adult:  { pitch: 1.0, rate: 0.95 },
      senior: { pitch: 0.9, rate: 0.9 }
    };

    const style = config[persona] || config.adult;

    utterance.pitch = style.pitch;
    utterance.rate = style.rate;

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  async function speakKokoro(text, lang = selectedLang) {
    try {
      const res = await fetch("http://127.0.0.1:5000/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang })
      });

      if (!res.ok) {
        console.error("TTS error:", await res.text());
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.play();
    } catch (e) {
      console.error("Kokoro fail:", e);
    }
  }

  function speak(text, lang = selectedLang, persona = selectedPersona || "adult") {
    if (window.USE_KOKORO) {
      speakKokoro(text, lang);
    } else {
      speakBrowser(text, lang, persona);
    }
  }


  const chatThread = el('chat-thread');
  const chatInput  = el('chat-input');

  function handleSend() {
    const value = chatInput.value.trim();
    if (!value) return;
    addBubble('user', value);
    chatInput.value = '';
    const replies = {
      en: "This is where GuIA would respond.",
      es: "Aquí es donde GuIA respondería.",
      ca: "Aquí és on GuIA respondria."
    };

    const reply = replies[selectedLang] || replies.en;
    addBubble('assistant', reply);
    speak(reply);
  }

  el('send-btn').addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });
}

function applyContext(roomText, artworkText) {
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