// State
const GUIA_SESSION_STORAGE_KEY = 'guia.session.v1';

function readStoredGuiaSession() {
  try {
    return JSON.parse(localStorage.getItem(GUIA_SESSION_STORAGE_KEY) || 'null');
  } catch (err) {
    console.warn('Could not read stored GuIA session:', err);
    return null;
  }
}

const storedGuiaSession = readStoredGuiaSession();
const DEFAULT_PERSONA = 'explorer';

const state = {
  selectedPersona: storedGuiaSession?.selectedPersona || DEFAULT_PERSONA,
  selectedAge: storedGuiaSession?.selectedAge || null,
  selectedLang: storedGuiaSession?.selectedLang || null,
  currentRoom: storedGuiaSession?.currentRoom || null,
  currentArtwork: storedGuiaSession?.currentArtwork || null,

  translations: {},
  locationData: { rooms: [] },

  onboardingStep: 1,
  totalSteps: 3,
  lastFocusedElement: null,
  privacyAccepted: !!storedGuiaSession?.privacyAccepted,
  chatStarted: !!storedGuiaSession?.chatStarted,
  showTutorialOnStart: storedGuiaSession?.showTutorialOnStart ?? true,
  deferredSpokenAudioChange: null,
  conversationTranslationRequestId: 0,
  chatGenerating: false,
  conversationTranslating: false,
  lastLocationLinkKey: null,

  accessibilityPrefs: {
    largeText: !!storedGuiaSession?.accessibilityPrefs?.largeText,
    uppercaseText: !!storedGuiaSession?.accessibilityPrefs?.uppercaseText,
    simpleLanguage: !!storedGuiaSession?.accessibilityPrefs?.simpleLanguage,
    spokenAudio: storedGuiaSession?.accessibilityPrefs?.spokenAudio ?? true,
    moreTime: !!storedGuiaSession?.accessibilityPrefs?.moreTime,
    visualDescriptions: !!storedGuiaSession?.accessibilityPrefs?.visualDescriptions

  }
};

const sessionId = storedGuiaSession?.sessionId || crypto.randomUUID();


const API_BASES = (() => {
  const isLocalHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  const isBackendPort = ['5000', '5002'].includes(window.location.port);
  const isLocalSplitServer = isLocalHost && !isBackendPort;

  return {
    llm: isLocalSplitServer ? 'http://127.0.0.1:5002' : '',
    audio: isLocalSplitServer ? 'http://127.0.0.1:5000' : ''
  };
})();

const API_ENDPOINTS = {
  chatStream: `${API_BASES.llm}/chat/stream`,
  translateConversation: `${API_BASES.llm}/translate-conversation`,
  context: `${API_BASES.llm}/context`,
  easyWords: `${API_BASES.llm}/easy-words`,
  locations: `${API_BASES.llm}/locations`,
  speak: `${API_BASES.audio}/speak`,
  transcribe: `${API_BASES.audio}/transcribe`,
  transcribeWarmup: `${API_BASES.audio}/transcribe/warmup`,
  translations: 'translations.json?v=20260524-tutorial-location'
};

const PERSONA_KEYS = ['explorer', 'artist', 'storyteller', 'scholar'];
const AGE_KEYS = ['young', 'adult', 'senior'];
const AUDIO_SPEED_KEYS = ['slow', 'normal', 'fast'];
const DEFAULT_LANGUAGE = 'ca';

const SPEECH_SPEED = {
  slow: 0.8,
  normal: 1,
  fast: 1.5
};

const BROWSER_SPEECH_LANG = {
  en: 'en-US',
  es: 'es-ES',
  ca: 'ca-ES'
};

const BROWSER_SPEECH_PERSONA = {
  child: { pitch: 1.6, rate: 1.05 },
  teen: { pitch: 1.2, rate: 1.0 },
  adult: { pitch: 1.0, rate: 0.95 },
  senior: { pitch: 0.9, rate: 0.9 }
};

const VOICE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4'
];

window.USE_KOKORO = true;
