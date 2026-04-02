// ─── State ────────────────────────────────────────────────────────────────────
let selectedPersona = null;
let selectedAge     = null;
let selectedLang    = null; 
let translations    = {};
let currentContext  = { room: '', artwork: '' };
let conversationHistory = [];
let isSending = false;
let isMuted = false;
let selectedSpeed = 'normal';
let isListening = false;
let sendCurrentMessage = null;
let pendingSpeechText = '';
let queuedSpeechSegments = [];
let isSpeakingQueuedSegment = false;
let currentSpeechAudio = null;
let currentSpeechUrl = null;
let speechSessionId = 0;
let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let recordingMimeType = '';
let shouldTranscribeRecording = false;
let liveTranscript = '';
let interimTranscript = '';
let voiceDraftPrefix = '';
let isTranscribingVoice = false;
let liveRecognition = null;

// New: prompt selection and model access now go through the Python backend.
const BACKEND_CHAT_URL = 'http://127.0.0.1:8000/api/chat';
const BACKEND_CHAT_STREAM_URL = 'http://127.0.0.1:8000/api/chat/stream';
const BACKEND_TTS_URL = 'http://127.0.0.1:8000/api/tts';
const BACKEND_TRANSCRIBE_URL = 'http://127.0.0.1:8000/api/transcribe';

const BACKEND_ERRORS = {
  en: 'GuIA could not reach the backend service. Make sure the Python backend is running.',
  es: 'GuIA no ha podido contactar con el backend. Asegurate de que el backend de Python este en ejecucion.',
  ca: "GuIA no ha pogut contactar amb el backend. Assegura't que el backend de Python estigui en execucio."
};

const FRONTEND_MESSAGES = {
  en: {
    emptyResponse: 'GuIA did not receive a valid reply.',
    noSpeech: 'No speech was detected in the recording.',
    transcriptionFailed: 'GuIA could not transcribe the recording.'
  },
  es: {
    emptyResponse: 'GuIA no ha recibido una respuesta valida.',
    noSpeech: 'No se ha detectado voz en la grabacion.',
    transcriptionFailed: 'GuIA no ha podido transcribir la grabacion.'
  },
  ca: {
    emptyResponse: 'GuIA no ha rebut una resposta valida.',
    noSpeech: "No s'ha detectat veu a la gravacio.",
    transcriptionFailed: "GuIA no ha pogut transcriure la gravacio."
  }
};

const RECORDING_HINTS = {
  en: { listening: 'Listening...', transcribing: 'Transcribing...' },
  es: { listening: 'Escuchando...', transcribing: 'Transcribiendo...' },
  ca: { listening: 'Escoltant...', transcribing: 'Transcrivint...' }
};

const RECOGNITION_LANGS = {
  en: 'en-US',
  es: 'es-ES',
  ca: 'ca-ES'
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

  document.title = t('app.title');

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
  el('set-context-btn').textContent = t('app.confirmLocation');

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
  document.querySelector('label[for="chat-input"]').textContent = t('chat.inputLabel');
  el('chat-input').placeholder = t('chat.placeholder');
  el('send-btn').textContent   = t('chat.send');
  el('mute-btn').setAttribute('aria-label', t('audio.mute'));
  el('mic-btn').setAttribute('aria-label', t('audio.voice'));
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

function getSelectedLanguage() {
  return selectedLang || 'ca';
}

function getRecordingHint(key) {
  const language = getSelectedLanguage();
  return RECORDING_HINTS[language]?.[key] || RECORDING_HINTS.ca[key];
}

function getFrontendMessage(key) {
  const language = getSelectedLanguage();
  return FRONTEND_MESSAGES[language]?.[key] || FRONTEND_MESSAGES.ca[key];
}

function getDisplayErrorMessage(error) {
  const message = error?.message || '';
  if (!message || message === 'Failed to fetch' || /NetworkError/i.test(message)) {
    return getBackendErrorMessage();
  }
  if (message === 'Empty backend response.') {
    return getFrontendMessage('emptyResponse');
  }
  if (/No speech could be transcribed/i.test(message)) {
    return getFrontendMessage('noSpeech');
  }
  if (/Could not transcribe audio/i.test(message) || /Invalid data found when processing input/i.test(message)) {
    return getFrontendMessage('transcriptionFailed');
  }
  return message;
}

function setMicActive(isActive) {
  const micBtn = el('mic-btn');
  if (!micBtn) return;
  micBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
}

function stopAssistantSpeech() {
  speechSessionId += 1;
  pendingSpeechText = '';
  queuedSpeechSegments = [];
  isSpeakingQueuedSegment = false;
  if (currentSpeechAudio) {
    currentSpeechAudio.pause();
    currentSpeechAudio.src = '';
    currentSpeechAudio = null;
  }
  if (currentSpeechUrl) {
    URL.revokeObjectURL(currentSpeechUrl);
    currentSpeechUrl = null;
  }
}

function updateVoiceDraftInput() {
  const parts = [];
  if (voiceDraftPrefix) parts.push(voiceDraftPrefix);
  if (liveTranscript) parts.push(liveTranscript);
  if (interimTranscript) parts.push(interimTranscript);
  el('chat-input').value = parts.join(' ').trim();
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getRecognitionLanguage() {
  return RECOGNITION_LANGS[getSelectedLanguage()] || RECOGNITION_LANGS.ca;
}

function stopLiveRecognition() {
  if (!liveRecognition) return;

  const recognition = liveRecognition;
  liveRecognition = null;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;

  try {
    recognition.stop();
  } catch (error) {
    console.warn('Live recognition stop failed:', error);
  }
}

function startLiveRecognition() {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = getRecognitionLanguage();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let nextFinalText = '';
    let nextInterimText = '';

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index]?.[0]?.transcript?.trim();
      if (!transcript) continue;

      if (event.results[index].isFinal) {
        nextFinalText += `${transcript} `;
      } else {
        nextInterimText += `${transcript} `;
      }
    }

    const finalChunk = nextFinalText.trim();
    if (finalChunk) {
      liveTranscript = liveTranscript
        ? `${liveTranscript} ${finalChunk}`.trim()
        : finalChunk;
    }

    interimTranscript = nextInterimText.trim();
    updateVoiceDraftInput();
  };

  recognition.onerror = (event) => {
    console.warn('Live recognition failed:', event.error);
    interimTranscript = '';
    updateVoiceDraftInput();
  };

  recognition.onend = () => {
    if (liveRecognition !== recognition) return;
    liveRecognition = null;
    interimTranscript = '';
    updateVoiceDraftInput();
    if (isListening) {
      startLiveRecognition();
    }
  };

  liveRecognition = recognition;

  try {
    recognition.start();
  } catch (error) {
    liveRecognition = null;
    console.warn('Live recognition start failed:', error);
  }
}

function findSpeechBoundary(text, flush = false) {
  const sentenceMatch = text.match(/[.!?]+(?:\s|$)|[:;](?:\s|$)|\n+/);
  if (sentenceMatch) {
    return sentenceMatch.index + sentenceMatch[0].length;
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const isFirstSegment = !queuedSpeechSegments.length && !isSpeakingQueuedSegment && !currentSpeechAudio;
  const wordThreshold = isFirstSegment ? 2 : 5;

  if (words.length >= wordThreshold) {
    let seenWords = 0;
    let insideWord = false;

    for (let index = 0; index < text.length; index += 1) {
      const isWhitespace = /\s/.test(text[index]);
      if (!isWhitespace && !insideWord) {
        insideWord = true;
        seenWords += 1;
      } else if (isWhitespace) {
        insideWord = false;
        if (seenWords >= wordThreshold) {
          return index + 1;
        }
      }
    }
  }

  if (flush && text.trim()) {
    return text.length;
  }

  return -1;
}

async function playNextSpeechSegment() {
  if (isMuted) return;
  if (isSpeakingQueuedSegment || !queuedSpeechSegments.length) return;

  const nextSegment = queuedSpeechSegments.shift();
  if (!nextSegment) return;

  isSpeakingQueuedSegment = true;
  const sessionId = speechSessionId;
  try {
    const response = await fetch(BACKEND_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: nextSegment,
        language: selectedLang,
        age: selectedAge,
        speed: selectedSpeed
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP ${response.status}`);
    }

    const audioBlob = await response.blob();
    if (sessionId !== speechSessionId || !audioBlob.size || isMuted) {
      isSpeakingQueuedSegment = false;
      playNextSpeechSegment();
      return;
    }

    currentSpeechUrl = URL.createObjectURL(audioBlob);
    currentSpeechAudio = new Audio(currentSpeechUrl);
    currentSpeechAudio.addEventListener('ended', () => {
      isSpeakingQueuedSegment = false;
      if (currentSpeechUrl) {
        URL.revokeObjectURL(currentSpeechUrl);
        currentSpeechUrl = null;
      }
      currentSpeechAudio = null;
      playNextSpeechSegment();
    });
    currentSpeechAudio.addEventListener('error', () => {
      isSpeakingQueuedSegment = false;
      if (currentSpeechUrl) {
        URL.revokeObjectURL(currentSpeechUrl);
        currentSpeechUrl = null;
      }
      currentSpeechAudio = null;
      playNextSpeechSegment();
    });
    await currentSpeechAudio.play();
  } catch (error) {
    console.error('Backend TTS failed:', error);
    isSpeakingQueuedSegment = false;
    playNextSpeechSegment();
  }
}

function queueAssistantSpeech(text, flush = false) {
  if (!text || isMuted) return;

  pendingSpeechText += text;

  // New: when the full reply is ready, synthesize it as a single segment so
  // punctuation does not create long pauses between multiple backend TTS calls.
  if (flush && pendingSpeechText.trim()) {
    queuedSpeechSegments.push(pendingSpeechText.trim());
    pendingSpeechText = '';
    playNextSpeechSegment();
    return;
  }

  while (true) {
    const boundary = findSpeechBoundary(pendingSpeechText, flush);
    if (boundary === -1) break;

    const nextSegment = pendingSpeechText.slice(0, boundary).trim();
    pendingSpeechText = pendingSpeechText.slice(boundary).trimStart();

    if (nextSegment) {
      queuedSpeechSegments.push(nextSegment);
    }
  }

  playNextSpeechSegment();
}

function getRecordingMimeType() {
  const supportedTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];

  for (const mimeType of supportedTypes) {
    if (window.MediaRecorder?.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return '';
}

function getRecordingExtension(mimeType) {
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('mp4')) return '.mp4';
  return '.webm';
}

async function transcribeRecordedAudio(audioBlob) {
  const formData = new FormData();
  formData.append('file', audioBlob, `speech${getRecordingExtension(audioBlob.type)}`);
  formData.append('language', getSelectedLanguage());

  const response = await fetch(BACKEND_TRANSCRIBE_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = errorText;

    try {
      const payload = JSON.parse(errorText);
      detail = payload.detail || payload.message || errorText;
    } catch (error) {
      detail = errorText;
    }

    throw new Error(detail || `HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload.text || '';
}

async function finalizeVoiceRecording() {
  isTranscribingVoice = true;
  const fallbackTranscript = interimTranscript.trim();
  interimTranscript = '';
  if (fallbackTranscript) {
    liveTranscript = liveTranscript
      ? `${liveTranscript} ${fallbackTranscript}`.trim()
      : fallbackTranscript;
  }
  updateVoiceDraftInput();

  try {
    // New: if the live browser recognizer already captured text, keep it and
    // skip the slower backend pass. The backend remains a fallback path.
    if (!liveTranscript && recordedChunks.length) {
      const audioBlob = new Blob(recordedChunks, { type: recordingMimeType || 'audio/webm' });
      const transcript = await transcribeRecordedAudio(audioBlob);
      if (transcript) {
        liveTranscript = transcript.trim();
        updateVoiceDraftInput();
      }
    }
  } catch (error) {
    console.error('Backend transcription failed:', error);
    if (!liveTranscript) {
      addBubble('assistant', getDisplayErrorMessage(error));
    }
  } finally {
    isTranscribingVoice = false;
    shouldTranscribeRecording = false;
    recordedChunks = [];
    recordingMimeType = '';
    mediaRecorder = null;
    el('chat-input').placeholder = t('chat.placeholder');
  }
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    addBubble('assistant', getBackendErrorMessage());
    return;
  }

  stopAssistantSpeech();
  voiceDraftPrefix = el('chat-input').value.trim();
  liveTranscript = '';
  interimTranscript = '';
  recordedChunks = [];
  shouldTranscribeRecording = true;

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = getRecordingMimeType();
  recordingMimeType = mimeType || 'audio/webm';
  mediaRecorder = mimeType
    ? new MediaRecorder(mediaStream, { mimeType })
    : new MediaRecorder(mediaStream);

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener('stop', async () => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    isListening = false;
    setMicActive(false);
    el('chat-input').placeholder = getRecordingHint('transcribing');
    await finalizeVoiceRecording();
  }, { once: true });

  mediaRecorder.addEventListener('error', () => {
    stopLiveRecognition();
    shouldTranscribeRecording = false;
    isTranscribingVoice = false;
    liveTranscript = '';
    interimTranscript = '';
    voiceDraftPrefix = '';
    recordedChunks = [];
    recordingMimeType = '';
    mediaRecorder = null;
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    isListening = false;
    setMicActive(false);
    el('chat-input').placeholder = t('chat.placeholder');
  }, { once: true });

  startLiveRecognition();
  mediaRecorder.start();
  isListening = true;
  setMicActive(true);
  el('chat-input').placeholder = getRecordingHint('listening');
}

function stopVoiceRecording() {
  stopLiveRecognition();

  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    shouldTranscribeRecording = false;
    isTranscribingVoice = false;
    liveTranscript = '';
    interimTranscript = '';
    voiceDraftPrefix = '';
    recordedChunks = [];
    recordingMimeType = '';
    mediaRecorder = null;
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    isListening = false;
    setMicActive(false);
    el('chat-input').placeholder = t('chat.placeholder');
    return;
  }

  mediaRecorder.stop();
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
    const reply = await requestAssistantReply(message);
    bubble.textContent = reply;
    queueAssistantSpeech(reply, true);
    return reply;
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
        } else if (event.type === 'done') {
          queueAssistantSpeech(reply, true);
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
      selectedSpeed = btn.dataset.speed;
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
    isMuted = muteBtn.getAttribute('aria-pressed') !== 'true';
    const on = !isMuted;
    muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    if (isMuted) {
      stopAssistantSpeech();
    }
    muteBtn.textContent = on ? '🔈' : '🔇';
  });

  // Mic
  const micBtn = el('mic-btn');
  micBtn.addEventListener('click', async () => {
    if (isListening) {
      stopVoiceRecording();
      return;
    }

    try {
      await startVoiceRecording();
    } catch (error) {
      console.error('Voice recording failed:', error);
      addBubble('assistant', getDisplayErrorMessage(error));
      stopVoiceRecording();
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
  const clearContextError = () => {
    el('context-error').textContent = '';
    roomSelect.removeAttribute('aria-invalid');
  };

  roomSelect.addEventListener('change', clearContextError);
  artworkSelect.addEventListener('change', clearContextError);

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
  const chatInput  = el('chat-input');

  async function handleSend() {
    const value = chatInput.value.trim();
    if (!value || isSending) return;

    if (isListening) {
      return;
    }
    if (isTranscribingVoice) {
      return;
    }
    stopAssistantSpeech();
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
      assistantBubble.textContent = getDisplayErrorMessage(error);
    } finally {
      isSending = false;
      el('send-btn').disabled = false;
      setTyping(false);
    }
  }

  sendCurrentMessage = handleSend;

  el('send-btn').addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });

  // New: quick suggestions should behave like real chat actions on the main screen.
  Array.from(document.querySelectorAll('.suggestion-btn')).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isSending || isListening || isTranscribingVoice) return;
      chatInput.value = btn.textContent.trim();
      handleSend();
    });
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
