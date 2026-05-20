// i18n
function getNestedTranslation(source, key) {
  return key.split('.').reduce((obj, k) => (obj ? obj[k] : undefined), source);
}

let translationsLoaded = false;

function t(key, fallback) {
  const currentLang = state.translations[state.selectedLang];
  const caLang = state.translations['ca'];

  return (
    getNestedTranslation(currentLang, key) ??
    getNestedTranslation(caLang, key) ??
    fallback ??
    key
  );
}

async function preloadTranslations() {
  if (translationsLoaded) return;

  try {
    const res = await fetch(API_ENDPOINTS.translations);
    if (!res.ok) throw new Error('translations.json fetch failed');
    state.translations = await res.json();
    translationsLoaded = true;
  } catch (e) {
    console.error('translations.json not found - serving without i18n', e);
    state.translations = {};
    translationsLoaded = false;
  }
}
