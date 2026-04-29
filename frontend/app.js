// ─── State ────────────────────────────────────────────────────────────────────
let selectedPersona = null;
let selectedAge     = null;
let selectedLang    = null;
let currentRoom     = null;
let currentArtwork  = null;
let translations    = {};
const sessionId = crypto.randomUUID();

window.USE_KOKORO = true;

// ─── i18n ─────────────────────────────────────────────────────────────────────

function getNestedTranslation(source, key) {
  return key.split('.').reduce((obj, k) => (obj ? obj[k] : undefined), source);
}

function t(key, fallback = '') {
  const currentLang = translations[selectedLang] || {};
  const caLang = translations['ca'] || {};

  return (
    getNestedTranslation(currentLang, key) ??
    getNestedTranslation(caLang, key) ??
    fallback ??
    key
  );
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
  ['young', 'adult', 'senior'].forEach((key) => {
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
      setSpeechSpeed(btn.dataset.speed || 'normal');
    });
  });

  // ─── Volume slider + Mute ─────────────────────────────────────────────────────
const muteBtn      = el('mute-btn');
const volumeSlider = el('volume-slider');
let isMuted        = false;
let currentVolume = 0.5;
let unmuteWaiters  = [];

function updateMuteIcon() {
  const muted = isMuted || (volumeSlider && Number(volumeSlider.value) === 0);
  muteBtn.textContent = muted ? '🔇' : '🔈';
  muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  muteBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
}

// Mute
function waitUntilUnmuted() {
  if (!isMuted) return Promise.resolve();

  return new Promise((resolve) => {
    unmuteWaiters.push(resolve);
  });
}

function releaseUnmuteWaiters() {
  const waiters = unmuteWaiters;
  unmuteWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function pauseAudioOutput() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
  }

  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
  }
}

function resumeAudioOutput() {
  if (currentAudio && currentAudio.paused) {
    currentAudio.play().catch((err) => {
      console.error("Audio resume failed:", err);
    });
  }
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  }
  releaseUnmuteWaiters();  // ← esto sí va aquí dentro
}

// Volume slider: fuera de resumeAudioOutput ↓
if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    const value = Number(volumeSlider.value);
    currentVolume = value / 100;

    if (value === 0) {
      if (!isMuted) {
        isMuted = true;
        pauseAudioOutput();
      }
    } else {
      if (isMuted) {
        isMuted = false;
        resumeAudioOutput();
      }
      if (currentAudio) currentAudio.volume = currentVolume;
    }
    updateMuteIcon();
  });
  updateMuteIcon();
}

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;

  muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  muteBtn.textContent = isMuted ? '🔇' : '🔈';
  muteBtn.setAttribute(
    'aria-label',
    isMuted ? 'Unmute audio' : 'Mute audio'
  );

  if (isMuted) {
    if (volumeSlider) volumeSlider.value = 0;
    pauseAudioOutput();
  } else {
    if (volumeSlider && Number(volumeSlider.value) === 0) {
      volumeSlider.value = 50;
    }
    resumeAudioOutput();
  }
  updateMuteIcon();
});

function speakInitialWelcome() {
  const firstBubble = document.querySelector(".assistant-bubble");
  const text = firstBubble?.textContent?.trim();
  if (!text) return;
  resetSpeechQueue();
  queueSpeech(text, selectedLang, selectedPersona || "adult");
}

el("onboarding-start").addEventListener("click", () => {
  setTimeout(() => {
    speakInitialWelcome();
  }, 0);
});

  // Mic
  const micBtn = el('mic-btn');
  if (!micBtn) return;
  const micStatus = el('mic-status');
  const micIcon = micBtn.querySelector('.material-symbols-outlined');
  const inputShell = document.querySelector('.input-shell');
  const chatInputForVoice = el('chat-input');
  const sendBtnForVoice = el('send-btn');
  const voiceInputStatus = el('voice-input-status');
  const voiceInputStatusText = el('voice-input-status-text');

  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceMimeType = '';
  let voiceRecording = false;
  let voiceProcessing = false;

  function setVoiceStatus(message, isError = false) {
    if (!micStatus) return;
    if (!message) {
      micStatus.textContent = '';
      micStatus.setAttribute('hidden', '');
      return;
    }
    micStatus.textContent = message;
    micStatus.hidden = false;
    micStatus.style.color = isError ? 'var(--error)' : 'var(--on-surface-variant)';
  }

  function setVoiceButtonState(recording) {
    micBtn.setAttribute('aria-pressed', recording ? 'true' : 'false');
    micBtn.setAttribute(
      'aria-label',
      recording ? t('audio.stop') : t('audio.voice')
    );
    micBtn.classList.toggle('is-listening', recording);
    if (micIcon) micIcon.textContent = recording ? 'stop' : 'mic';
  }

  function setVoiceInputTranscribing(transcribing) {
    inputShell?.classList.toggle('is-transcribing', transcribing);

    if (chatInputForVoice) {
      chatInputForVoice.disabled = transcribing;
      if (transcribing) {
        chatInputForVoice.setAttribute('aria-busy', 'true');
      } else {
        chatInputForVoice.removeAttribute('aria-busy');
      }
    }

    if (sendBtnForVoice) sendBtnForVoice.disabled = transcribing;

    if (!voiceInputStatus) return;
    if (transcribing) {
      if (voiceInputStatusText) {
        voiceInputStatusText.textContent = t('audio.transcribing');
      }
      voiceInputStatus.hidden = false;
    } else {
      voiceInputStatus.setAttribute('hidden', '');
    }
  }

  function cleanupVoiceStream() {
    if (!voiceStream) return;
    voiceStream.getTracks().forEach((track) => track.stop());
    voiceStream = null;
  }

  function supportedVoiceMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    const preferredTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4'
    ];
    return preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function transcribeVoiceRecording() {
    const blob = new Blob(voiceChunks, { type: voiceMimeType || 'audio/webm' });
    if (!blob.size) {
      setVoiceStatus(t('audio.empty'), true);
      return;
    }

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('lang', selectedLang || 'auto');

    const res = await fetch('http://127.0.0.1:5000/transcribe', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `Transcription failed with ${res.status}`);
    }

    const data = await res.json();
    const text = (data.text || '').trim();
    if (!text) {
      setVoiceStatus(t('audio.empty'), true);
      return;
    }

    el('chat-input').value = text;
    setVoiceStatus('');
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus(t('audio.unavailable'), true);
      return;
    }

    micBtn.disabled = true;
    setVoiceStatus(t('audio.requesting'));

    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceMimeType = supportedVoiceMimeType();
      voiceRecorder = voiceMimeType
        ? new MediaRecorder(voiceStream, { mimeType: voiceMimeType })
        : new MediaRecorder(voiceStream);
      voiceChunks = [];

      voiceRecorder.ondataavailable = (event) => {
        if (event.data?.size) voiceChunks.push(event.data);
      };

      voiceRecorder.onerror = (event) => {
        console.error('Microphone recording error:', event.error || event);
        setVoiceStatus(t('audio.failed'), true);
      };

      voiceRecorder.onstop = async () => {
        cleanupVoiceStream();
        voiceRecording = false;
        voiceProcessing = true;
        setVoiceButtonState(false);
        setVoiceInputTranscribing(true);
        setVoiceStatus('');

        try {
          await transcribeVoiceRecording();
        } catch (err) {
          console.error('Transcription error:', err);
          setVoiceStatus(t('audio.failed'), true);
        } finally {
          voiceRecorder = null;
          voiceChunks = [];
          voiceMimeType = '';
          voiceProcessing = false;
          micBtn.disabled = false;
          setVoiceInputTranscribing(false);
          if (chatInputForVoice?.value.trim()) chatInputForVoice.focus();
        }
      };

      voiceRecorder.start();
      voiceRecording = true;
      setVoiceButtonState(true);
      setVoiceStatus(t('audio.recording'));
    } catch (err) {
      console.error('Microphone access error:', err);
      cleanupVoiceStream();
      voiceRecorder = null;
      voiceMimeType = '';
      voiceRecording = false;
      setVoiceButtonState(false);
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setVoiceStatus(denied ? t('audio.denied') : t('audio.failed'), true);
    } finally {
      if (!voiceProcessing) micBtn.disabled = false;
    }
  }

  function stopVoiceRecording() {
    if (!voiceRecorder || voiceRecorder.state !== 'recording') return;
    micBtn.disabled = true;
    setVoiceInputTranscribing(true);
    setVoiceStatus('');
    voiceRecorder.stop();
  }

  micBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (voiceProcessing || micBtn.disabled) return;
    if (voiceRecording) {
      stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  }, true);

  /* Legacy mic implementation disabled; superseded by the recorder above.
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

  micBtn.addEventListener('legacy-click-disabled', async () => {
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

  */

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
  function speakBrowser(text, lang = selectedLang, persona = "adult", cancelExisting = true) {
    return new Promise((resolve) => {
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
      const speedRate = {
        slow: 0.8,
        normal: 1,
        fast: 1.2
      };

      utterance.rate = style.rate * (speedRate[currentSpeechSpeed] || 1);
      utterance.onend = resolve;
      utterance.onerror = resolve;

      if (cancelExisting) speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
  }

  async function fetchKokoroAudio(text, lang = selectedLang) {
    const res = await fetch("http://127.0.0.1:5000/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lang,
        speed: currentSpeechSpeed
      })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return res.blob();
  }

  function playAudioBlob(blob) {
    return new Promise(async (resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = currentVolume;
      currentAudio = audio;

      const cleanup = () => {
        if (currentAudio === audio) {
          currentAudio = null;
        }

        URL.revokeObjectURL(url);
        resolve();
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;

      try {
        await waitUntilUnmuted();

        if (currentAudio !== audio) {
          cleanup();
          return;
        }

        await audio.play();
      } catch (err) {
        console.error("Audio playback failed:", err);
        cleanup();
      }
    });
  }

  let speechPlaybackQueue = Promise.resolve();
  let speechQueueVersion = 0;
  let currentAudio = null;

  function stopCurrentAudio() {
    if (!currentAudio) return;

    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  function resetSpeechQueue() {
    speechQueueVersion += 1;
    speechPlaybackQueue = Promise.resolve();

    stopCurrentAudio();
    speechSynthesis.cancel();
  }

  function queueSpeech(text, lang = selectedLang, persona = selectedPersona || "adult") {
    const sentence = text.trim();
    if (!sentence) return;

    const queueVersion = speechQueueVersion;

    if (window.USE_KOKORO) {
      const audioPromise = fetchKokoroAudio(sentence, lang)
        .then((blob) => ({ blob }))
        .catch((err) => ({ err }));

      speechPlaybackQueue = speechPlaybackQueue
        .catch(() => {})
        .then(async () => {
          if (queueVersion !== speechQueueVersion) return;

          await waitUntilUnmuted();

          if (queueVersion !== speechQueueVersion) return;

          try {
            const result = await audioPromise;

            if (queueVersion !== speechQueueVersion) return;
            if (result.err) throw result.err;

            await playAudioBlob(result.blob);
          } catch (err) {
            console.error("Kokoro fail:", err);
          }
        });

      return;
    }

    speechPlaybackQueue = speechPlaybackQueue
      .catch(() => {})
      .then(async () => {
        if (queueVersion !== speechQueueVersion) return;

        await waitUntilUnmuted();

        if (queueVersion !== speechQueueVersion) return;

        return speakBrowser(sentence, lang, persona, false);
      });
  }


  const chatThread = el('chat-thread');
  const chatInput  = el('chat-input');
  const sendBtn = el('send-btn');
  const typingIndicator = el('typing-indicator');
  let isGenerating = false;
  let lastAssistantText = '';
  let currentSpeechSpeed = 'normal';

  function setThinkingIndicator(isThinking) {
    if (!typingIndicator) return;

    if (isThinking) {
      typingIndicator.hidden = false;
      typingIndicator.removeAttribute('hidden');
      typingIndicator.setAttribute('aria-hidden', 'false');
      typingIndicator.classList.add('is-visible');
      typingIndicator.style.display = 'inline-flex';
    } else {
      typingIndicator.hidden = true;
      typingIndicator.setAttribute('hidden', '');
      typingIndicator.setAttribute('aria-hidden', 'true');
      typingIndicator.classList.remove('is-visible');
      typingIndicator.style.display = 'none';
    }
  }

  setThinkingIndicator(false);

    function appendToBubble(bubble, text) {
      bubble.textContent += text;
      chatThread.scrollTop = chatThread.scrollHeight;
    }

  function extractCompleteSentences(buffer) {
    const sentences = [];
    const sentenceEndPattern = /[.!?。！？]+(?=\s|$)/g;
    let lastEnd = 0;
    let match;

    while ((match = sentenceEndPattern.exec(buffer)) !== null) {
      const end = sentenceEndPattern.lastIndex;
      const sentence = buffer.slice(lastEnd, end).trim();
      if (sentence) sentences.push(sentence);
      lastEnd = end;
      while (buffer[lastEnd] === ' ' || buffer[lastEnd] === '\n') lastEnd += 1;
    }

    return {
      sentences,
      remainder: buffer.slice(lastEnd)
    };
  }

  async function readNdjsonStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        onEvent(JSON.parse(line));
      }
    }

    pending += decoder.decode();
    if (pending.trim()) onEvent(JSON.parse(pending));
  }

  async function streamAssistantReply(payload) {
    let assistantBubble = null;
    let receivedText = false;
    let sentenceBuffer = '';
    let fullAssistantText = '';

    try {
      const res = await fetch("http://127.0.0.1:5002/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      if (!res.body) {
        throw new Error("This browser does not support streamed responses.");
      }

      await readNdjsonStream(res, (event) => {
        if (event.type === 'delta') {
          const text = event.text || '';
          if (!text) return;

          if (!receivedText) {
            receivedText = true;
            setThinkingIndicator(false);
            assistantBubble = addBubble('assistant', '');
          }

          appendToBubble(assistantBubble, text);
          sentenceBuffer += text;
          fullAssistantText += text;

          const extracted = extractCompleteSentences(sentenceBuffer);
          extracted.sentences.forEach((sentence) => queueSpeech(sentence));
          sentenceBuffer = extracted.remainder;
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Streaming chat failed');
        }
      });

      if (sentenceBuffer.trim()) {
        queueSpeech(sentenceBuffer);
      }

      if (fullAssistantText.trim()) {
        lastAssistantText = fullAssistantText.trim();
      }

      if (!receivedText) {
        addBubble('assistant', t('chat.emptyResponse', "I couldn't generate a response."));
      }
    } finally {
      setThinkingIndicator(false);
    }
  }

  async function handleSend() {
    if (isGenerating) return;

    const value = chatInput.value.trim();
    if (!value) return;

    addBubble('user', value);
    chatInput.value = '';

    resetSpeechQueue();
    setThinkingIndicator(true);

    isGenerating = true;
    sendBtn.disabled = true;

    try {
      await streamAssistantReply({
        session_id: sessionId,
        message: value,
        language: selectedLang,
        age_range: selectedAge || "Adult 20-60 years old",
        personality: selectedPersona,
        room: currentRoom,
        artwork: currentArtwork
      });
    } catch (e) {
      console.error("Chat error:", e);
      setThinkingIndicator(false);
      addBubble('assistant', t('chat.connectionError'));
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      setThinkingIndicator(false);
    }
  }

  function setSpeechSpeed(speed) {
    currentSpeechSpeed = speed;

    speedBtns.forEach((btn) => {
      const on = btn.dataset.speed === speed;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function initSuggestionButtons() {
    const suggestionBtns = Array.from(document.querySelectorAll('.suggestion-btn'));

    suggestionBtns.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        // 1. Tell me about this artwork
        if (index === 0) {
          chatInput.value = btn.textContent.trim();
          handleSend();
          return;
        }

        // 2. Repeat
        if (index === 1) {
          if (!lastAssistantText.trim()) return;
          resetSpeechQueue();
          queueSpeech(lastAssistantText);
          return;
        }

        // 3. Go slower
        if (index === 2) {
          setSpeechSpeed('slow');

          // Optional: also ask the guide to continue more slowly/simply
          chatInput.value = btn.textContent.trim();
          handleSend();
        }
      });
    });
  }

  initSuggestionButtons();

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });
}

function applyContext(roomText, artworkText) {
  // Solo actualiza el header si los elementos existen
  
  // Store context
  currentRoom = roomText;
  currentArtwork = artworkText;

  // Update header
  const roomEl    = el('current-room');
  const artworkEl = el('current-artwork');
  if (roomEl)    roomEl.textContent    = t('app.room') + ': ' + roomText;
  if (artworkEl) artworkEl.textContent = t('app.artwork') + ': ' + (artworkText || t('context.notSet'));

  el('context-error').textContent = '';
  el('room-select').removeAttribute('aria-invalid');

  const msg = artworkText ? `${roomText} · ${artworkText}` : roomText;
  addBubble('user', msg);
  el('context-box').setAttribute('hidden', '');

  // Send context to LLM backend
  fetch("http://127.0.0.1:5002/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      room: roomText,
      artwork: artworkText
    })
  }).catch(e => console.warn("Could not send context to backend:", e));
}
