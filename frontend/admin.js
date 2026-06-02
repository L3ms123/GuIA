const authForm = document.querySelector('#auth-form');
const passwordInput = document.querySelector('#admin-password');
const authStatus = document.querySelector('#auth-status');
const sessionPanel = document.querySelector('#session-panel');
const logoutBtn = document.querySelector('#logout-btn');
const adminLanguage = document.querySelector('#admin-language');
const adminTabs = document.querySelector('#admin-tabs');
const uploadsSection = document.querySelector('#uploads-section');
const unresolvedSection = document.querySelector('#unresolved-section');
const analyticsSection = document.querySelector('#analytics-section');
const uploadGrid = document.querySelector('#upload-grid');
const analyticsPanel = document.querySelector('#analytics-panel');
const refreshAnalyticsBtn = document.querySelector('#refresh-analytics');
const downloadAnalyticsBtn = document.querySelector('#download-analytics');
const toggleAnalyticsViewBtn = document.querySelector('#toggle-analytics-view');
const analyticsWarning = document.querySelector('#analytics-warning');
const analyticsPath = document.querySelector('#analytics-path');
const unresolvedList = document.querySelector('#unresolved-list');
const unresolvedStatus = document.querySelector('#unresolved-status');
const refreshUnresolvedBtn = document.querySelector('#refresh-unresolved');

let adminPassword = '';
let activeSection = 'uploads';
let analyticsView = 'summary';
let lastAnalytics = null;
const TRANSLATIONS = {
  en: {
    brand: 'GuIA del Museu del Renaixement',
    title: 'Admin Portal',
    language: 'Language',
    openGuide: 'Open guide',
    authTitle: 'Protected admin access',
    authHelp: 'Use the admin secret configured in Hugging Face to manage museum data and analytics.',
    password: 'Password',
    unlock: 'Unlock',
    unlockedTitle: 'Admin access unlocked',
    unlockedHelp: 'Protected uploads and analytics are visible on this device.',
    logout: 'Log out',
    uploadsTab: 'Artworks',
    unresolvedTab: 'Unresolved questions',
    analyticsTab: 'Analytics',
    unresolvedTitle: 'Unresolved questions',
    unresolvedHelp: 'Review questions GuIA could not answer and add missing information to an existing graph entity.',
    noUnresolved: 'No unresolved questions are waiting for review.',
    entityId: 'Existing entity identifier',
    missingInformation: 'Missing information',
    relationshipTarget: 'Existing relationship target identifier',
    accept: 'Accept and update graph',
    reject: 'Reject',
    resolving: 'Updating...',
    artpieceHelp: 'Upload the artwork spreadsheet or CSV. Excel files should keep the header row used by the current template.',
    visualHelp: 'Upload VisualDescription.csv with comma-separated values and an artwork_id column.',
    artistHelp: "Upload AuthorInfo.csv using semicolon-separated values and the Author's Name column.",
    techniqueHelp: 'Upload Tech.csv using semicolon-separated values and the Art Technique column.',
    syncArtpiece: 'Sync ArtPiece',
    syncDescriptions: 'Sync descriptions',
    syncArtists: 'Sync artists',
    syncTechniques: 'Sync techniques',
    templateRules: 'Template rules',
    templateHelp: 'Keep the template column names unchanged. ArtPiece uploads create or update artwork nodes and link them to matching Artist and Technique nodes. VisualDescription uploads attach descriptions to existing artwork IDs.',
    analyticsTitle: 'Analytics',
    analyticsHelp: 'Metadata-only session summary.',
    downloadJsonl: 'Download JSONL',
    refresh: 'Refresh',
    showCharts: 'Show charts',
    showSummary: 'Show summary',
    visits: 'Visits',
    questions: 'Questions',
    locations: 'Locations',
    avgChars: 'Avg question chars',
    languages: 'Languages',
    ages: 'Ages',
    guideStyles: 'Guide styles',
    selectedFlags: 'Selected flags',
    roomsVisited: 'Rooms visited',
    recentVisits: 'Recent visits',
    started: 'Started',
    languageColumn: 'Language',
    ageColumn: 'Age',
    flagsColumn: 'Flags',
    roomsColumn: 'Rooms',
    questionsColumn: 'Questions',
    avgCharsColumn: 'Avg chars',
    checking: 'Checking access...',
    unlockedOk: 'Unlocked. Neo4j is configured.',
    unlockedNoNeo4j: 'Unlocked, but Neo4j secrets are incomplete.',
    loggedOut: 'Logged out.',
    analyticsDisabled: 'Analytics are currently disabled. Set GUIA_ANALYTICS_ENABLED=true and use persistent storage to record new sessions.',
    noData: 'No data yet',
    noSessions: 'No sessions recorded yet.',
    ready: 'Ready',
    uploading: 'Uploading and syncing...',
    chooseFile: 'Choose a file to upload.',
    unlockFirst: 'Unlock the portal first.',
    synced: 'Synced'
  },
  ca: {
    brand: 'GuIA del Museu del Renaixement',
    title: 'Portal d’administració',
    language: 'Idioma',
    openGuide: 'Obrir guia',
    authTitle: 'Accés d’administració protegit',
    authHelp: 'Fes servir el secret configurat a Hugging Face per gestionar les dades del museu i les analítiques.',
    password: 'Contrasenya',
    unlock: 'Desbloquejar',
    unlockedTitle: 'Accés d’administració desbloquejat',
    unlockedHelp: 'Les càrregues protegides i les analítiques són visibles en aquest dispositiu.',
    logout: 'Tancar sessió',
    uploadsTab: 'Obres',
    unresolvedTab: 'Preguntes pendents',
    analyticsTab: 'Analítiques',
    unresolvedTitle: 'Preguntes pendents',
    unresolvedHelp: 'Revisa les preguntes que GuIA no ha pogut respondre i afegeix la informació a una entitat existent del graf.',
    noUnresolved: 'No hi ha preguntes pendents de revisió.',
    entityId: 'Identificador de l’entitat existent',
    missingInformation: 'Informació que falta',
    relationshipTarget: 'Identificador de l’objectiu existent',
    accept: 'Acceptar i actualitzar el graf',
    reject: 'Rebutjar',
    resolving: 'Actualitzant...',
    artpieceHelp: 'Puja el full de càlcul o CSV de les obres. Els fitxers Excel han de mantenir la fila de capçaleres de la plantilla actual.',
    visualHelp: 'Puja VisualDescription.csv amb valors separats per comes i una columna artwork_id.',
    artistHelp: "Puja AuthorInfo.csv amb valors separats per punt i coma i la columna Author's Name.",
    techniqueHelp: 'Puja Tech.csv amb valors separats per punt i coma i la columna Art Technique.',
    syncArtpiece: 'Sincronitzar ArtPiece',
    syncDescriptions: 'Sincronitzar descripcions',
    syncArtists: 'Sincronitzar artistes',
    syncTechniques: 'Sincronitzar tècniques',
    templateRules: 'Regles de plantilla',
    templateHelp: 'Mantén els noms de columna sense canvis. Les càrregues ArtPiece creen o actualitzen obres i les enllacen amb Artist i Technique. VisualDescription afegeix descripcions a artwork_id existents.',
    analyticsTitle: 'Analítiques',
    analyticsHelp: 'Resum de sessions només amb metadades.',
    downloadJsonl: 'Descarregar JSONL',
    refresh: 'Actualitzar',
    showCharts: 'Veure gràfics',
    showSummary: 'Veure resum',
    visits: 'Visites',
    questions: 'Preguntes',
    locations: 'Ubicacions',
    avgChars: 'Mitjana de caràcters',
    languages: 'Idiomes',
    ages: 'Edats',
    guideStyles: 'Estils de guia',
    selectedFlags: 'Opcions triades',
    roomsVisited: 'Sales visitades',
    recentVisits: 'Visites recents',
    started: 'Inici',
    languageColumn: 'Idioma',
    ageColumn: 'Edat',
    flagsColumn: 'Opcions',
    roomsColumn: 'Sales',
    questionsColumn: 'Preguntes',
    avgCharsColumn: 'Mitjana caràcters',
    checking: 'Comprovant accés...',
    unlockedOk: 'Desbloquejat. Neo4j està configurat.',
    unlockedNoNeo4j: 'Desbloquejat, però falten secrets de Neo4j.',
    loggedOut: 'Sessió tancada.',
    analyticsDisabled: 'Les analítiques estan desactivades. Configura GUIA_ANALYTICS_ENABLED=true i emmagatzematge persistent per registrar noves sessions.',
    noData: 'Encara no hi ha dades',
    noSessions: 'Encara no hi ha sessions registrades.',
    ready: 'Preparat',
    uploading: 'Pujant i sincronitzant...',
    chooseFile: 'Tria un fitxer per pujar.',
    unlockFirst: 'Desbloqueja primer el portal.',
    synced: 'Sincronitzades'
  },
  es: {
    brand: 'GuIA del Museu del Renaixement',
    title: 'Portal de administración',
    language: 'Idioma',
    openGuide: 'Abrir guía',
    authTitle: 'Acceso de administración protegido',
    authHelp: 'Usa el secreto configurado en Hugging Face para gestionar datos del museo y analíticas.',
    password: 'Contraseña',
    unlock: 'Desbloquear',
    unlockedTitle: 'Acceso de administración desbloqueado',
    unlockedHelp: 'Las cargas protegidas y las analíticas son visibles en este dispositivo.',
    logout: 'Cerrar sesión',
    uploadsTab: 'Obras',
    unresolvedTab: 'Preguntas pendientes',
    analyticsTab: 'Analíticas',
    unresolvedTitle: 'Preguntas pendientes',
    unresolvedHelp: 'Revisa las preguntas que GuIA no pudo responder y añade la información a una entidad existente del grafo.',
    noUnresolved: 'No hay preguntas pendientes de revisión.',
    entityId: 'Identificador de la entidad existente',
    missingInformation: 'Información que falta',
    relationshipTarget: 'Identificador del objetivo existente',
    accept: 'Aceptar y actualizar el grafo',
    reject: 'Rechazar',
    resolving: 'Actualizando...',
    artpieceHelp: 'Sube la hoja de cálculo o CSV de obras. Los archivos Excel deben mantener la fila de cabeceras de la plantilla actual.',
    visualHelp: 'Sube VisualDescription.csv con valores separados por comas y una columna artwork_id.',
    artistHelp: "Sube AuthorInfo.csv con valores separados por punto y coma y la columna Author's Name.",
    techniqueHelp: 'Sube Tech.csv con valores separados por punto y coma y la columna Art Technique.',
    syncArtpiece: 'Sincronizar ArtPiece',
    syncDescriptions: 'Sincronizar descripciones',
    syncArtists: 'Sincronizar artistas',
    syncTechniques: 'Sincronizar técnicas',
    templateRules: 'Reglas de plantilla',
    templateHelp: 'Mantén los nombres de columna sin cambios. Las cargas ArtPiece crean o actualizan obras y las enlazan con Artist y Technique. VisualDescription añade descripciones a artwork_id existentes.',
    analyticsTitle: 'Analíticas',
    analyticsHelp: 'Resumen de sesiones solo con metadatos.',
    downloadJsonl: 'Descargar JSONL',
    refresh: 'Actualizar',
    showCharts: 'Ver gráficos',
    showSummary: 'Ver resumen',
    visits: 'Visitas',
    questions: 'Preguntas',
    locations: 'Ubicaciones',
    avgChars: 'Media de caracteres',
    languages: 'Idiomas',
    ages: 'Edades',
    guideStyles: 'Estilos de guía',
    selectedFlags: 'Opciones elegidas',
    roomsVisited: 'Salas visitadas',
    recentVisits: 'Visitas recientes',
    started: 'Inicio',
    languageColumn: 'Idioma',
    ageColumn: 'Edad',
    flagsColumn: 'Opciones',
    roomsColumn: 'Salas',
    questionsColumn: 'Preguntas',
    avgCharsColumn: 'Media caracteres',
    checking: 'Comprobando acceso...',
    unlockedOk: 'Desbloqueado. Neo4j está configurado.',
    unlockedNoNeo4j: 'Desbloqueado, pero faltan secretos de Neo4j.',
    loggedOut: 'Sesión cerrada.',
    analyticsDisabled: 'Las analíticas están desactivadas. Configura GUIA_ANALYTICS_ENABLED=true y almacenamiento persistente para registrar nuevas sesiones.',
    noData: 'Todavía no hay datos',
    noSessions: 'Todavía no hay sesiones registradas.',
    ready: 'Preparado',
    uploading: 'Subiendo y sincronizando...',
    chooseFile: 'Elige un archivo para subir.',
    unlockFirst: 'Desbloquea primero el portal.',
    synced: 'Sincronizadas'
  }
};

function text(key) {
  return (TRANSLATIONS[adminLanguage.value] || TRANSLATIONS.en)[key] || TRANSLATIONS.en[key] || key;
}

function applyTranslations() {
  document.documentElement.lang = adminLanguage.value;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = text(node.dataset.i18n);
  });
  toggleAnalyticsViewBtn.textContent = text(analyticsView === 'summary' ? 'showCharts' : 'showSummary');
}

function setUnlocked(isUnlocked) {
  if (!isUnlocked) {
    adminPassword = '';
  }

  authForm.hidden = isUnlocked;
  sessionPanel.hidden = !isUnlocked;
  adminTabs.hidden = !isUnlocked;
  showSection(isUnlocked ? activeSection : null);

  if (!isUnlocked) {
    passwordInput.value = '';
    document.querySelectorAll('.upload-card input[type="file"]').forEach((input) => {
      input.value = '';
    });
    document.querySelectorAll('.upload-status').forEach((status) => {
      setStatus(status, '');
    });
  }
}

function showSection(section) {
  const isUnlocked = !!adminPassword;
  activeSection = section || activeSection;
  uploadsSection.hidden = !isUnlocked || activeSection !== 'uploads';
  unresolvedSection.hidden = !isUnlocked || activeSection !== 'unresolved';
  analyticsSection.hidden = !isUnlocked || activeSection !== 'analytics';
  document.querySelectorAll('[data-section-target]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sectionTarget === activeSection);
  });
  if (isUnlocked && activeSection === 'analytics') {
    loadAnalytics();
  }
  if (isUnlocked && activeSection === 'unresolved') {
    loadUnresolvedQuestions();
  }
}

function setStatus(element, message, type = '') {
  element.textContent = message;
  element.classList.toggle('is-error', type === 'error');
  element.classList.toggle('is-success', type === 'success');
}

async function postStatus(password) {
  const response = await fetch('/admin/api/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not unlock admin portal.');
  }
  return data;
}

async function postAnalytics() {
  const response = await fetch('/admin/api/analytics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: adminPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not load analytics.');
  }
  return data.analytics;
}

async function downloadAnalytics() {
  const response = await fetch('/admin/api/analytics/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: adminPassword }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Could not download analytics.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sessions.jsonl';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatList(values, empty = '-') {
  if (!values || !values.length) return empty;
  return values.join(', ');
}

function truePrefs(prefs) {
  return Object.entries(prefs || {})
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function renderCounter(selector, values) {
  const target = document.querySelector(selector);
  if (!target) return;
  const entries = Object.entries(values || {}).sort((a, b) => b[1] - a[1]);
    target.innerHTML = '';
  if (!entries.length) {
    target.textContent = text('noData');
    return;
  }

  entries.forEach(([label, count]) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.innerHTML = `<span>${label}</span><strong>${count}</strong>`;
    target.append(pill);
  });
}

function renderChart(selector, values) {
  const target = document.querySelector(selector);
  if (!target) return;
  const entries = Object.entries(values || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  target.innerHTML = '';
  if (!entries.length) {
    target.textContent = text('noData');
    return;
  }

  const max = Math.max(...entries.map(([, value]) => value), 1);
  entries.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const width = Math.max(4, Math.round((value / max) * 100));
    row.innerHTML = `
      <span class="bar-label"></span>
      <span class="bar-track"><span class="bar-fill" style="width: ${width}%"></span></span>
      <strong class="bar-value">${value}</strong>
    `;
    row.querySelector('.bar-label').textContent = label;
    target.append(row);
  });
}

function setAnalyticsView(view) {
  analyticsView = view;
  document.querySelector('.analytics-grid').hidden = view !== 'summary';
  document.querySelector('.recent-block').hidden = view !== 'summary';
  document.querySelector('#charts-panel').hidden = view !== 'charts';
  toggleAnalyticsViewBtn.textContent = text(view === 'summary' ? 'showCharts' : 'showSummary');
  if (lastAnalytics) {
    renderCharts(lastAnalytics);
  }
}

function renderCharts(analytics) {
  renderChart('#chart-languages', analytics?.languages);
  renderChart('#chart-ages', analytics?.ages);
  renderChart('#chart-preferences', analytics?.preferences);
  renderChart('#chart-rooms', analytics?.rooms);
}

function renderAnalytics(analytics) {
  lastAnalytics = analytics;
  const totals = analytics?.totals || {};
  document.querySelector('#metric-visits').textContent = totals.visits || 0;
  document.querySelector('#metric-questions').textContent = totals.questions || 0;
  document.querySelector('#metric-locations').textContent = totals.locations || 0;
  document.querySelector('#metric-avg-chars').textContent = analytics?.questionChars?.avg || 0;
  analyticsPath.textContent = `Source: ${analytics?.path || 'analytics/sessions.jsonl'}`;

  analyticsWarning.hidden = !!analytics?.enabled;
  analyticsWarning.textContent = analytics?.enabled
    ? ''
    : text('analyticsDisabled');

  renderCounter('#analytics-languages', analytics?.languages);
  renderCounter('#analytics-ages', analytics?.ages);
  renderCounter('#analytics-personas', analytics?.personas);
  renderCounter('#analytics-preferences', analytics?.preferences);
  renderCounter('#analytics-rooms', analytics?.rooms);
  renderCharts(analytics);

  const tbody = document.querySelector('#recent-visits-body');
  tbody.innerHTML = '';
  const visits = analytics?.recentVisits || [];
  if (!visits.length) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="7">${text('noSessions')}</td>`;
    tbody.append(row);
    return;
  }

  visits.forEach((visit) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDate(visit.startedAt)}</td>
      <td>${visit.lang || '-'}</td>
      <td>${visit.age || '-'}</td>
      <td>${formatList(truePrefs(visit.prefs))}</td>
      <td>${formatList(visit.rooms)}</td>
      <td>${visit.questions || 0}</td>
      <td>${visit.avgQuestionChars || 0}</td>
    `;
    tbody.append(row);
  });
}

async function loadAnalytics() {
  if (!adminPassword) return;
  refreshAnalyticsBtn.disabled = true;
  try {
    renderAnalytics(await postAnalytics());
  } catch (error) {
    analyticsWarning.hidden = false;
    analyticsWarning.textContent = error.message;
  } finally {
    refreshAnalyticsBtn.disabled = false;
  }
}

async function postUnresolved(path = '', payload = {}) {
  const response = await fetch(`/admin/api/unresolved${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not update unresolved questions.');
  }
  return data;
}

function createUnresolvedCard(question) {
  const card = document.createElement('article');
  card.className = 'unresolved-card';
  const title = document.createElement('h3');
  title.textContent = question.question;
  const meta = document.createElement('p');
  meta.className = 'unresolved-meta';
  meta.textContent = [
    question.language || '-',
    question.roomId || '-',
    question.artworkId || '-',
    `Asked ${question.askCount || 1} time(s)`,
  ].join(' | ');
  const form = document.createElement('form');
  form.className = 'resolution-form';
  const inferredUpdates = question.inferredUpdates || [];
  const inputs = new Map();
  inferredUpdates.forEach((update) => {
    const field = document.createElement('label');
    field.className = 'wide-field';
    const label = document.createElement('span');
    label.textContent = update.fieldLabel;
    field.append(label);
    const updateInputs = {};
    if (!update.entityId) {
      const entityId = document.createElement('input');
      entityId.placeholder = text('entityId');
      entityId.required = true;
      field.append(entityId);
      updateInputs.entityId = entityId;
    }
    const value = update.kind === 'property' ? document.createElement('textarea') : document.createElement('input');
    if (update.kind === 'property') value.rows = 4;
    value.placeholder = update.kind === 'property' ? text('missingInformation') : text('relationshipTarget');
    value.required = true;
    field.append(value);
    updateInputs.value = value;
    inputs.set(update.key, updateInputs);
    form.append(field);
  });
  const actions = document.createElement('div');
  actions.className = 'resolution-actions wide-field';
  actions.innerHTML = `
    <button class="btn-primary" type="submit">${text('accept')}</button>
    <button class="btn-secondary compact" type="button" data-action="reject">${text('reject')}</button>
  `;
  const status = document.createElement('p');
  status.className = 'status-text wide-field';
  status.setAttribute('role', 'status');
  form.append(actions, status);
  if (!inferredUpdates.length) {
    setStatus(status, 'The failed query did not identify a supported missing graph field.', 'error');
    actions.querySelector('[type="submit"]').disabled = true;
  }

  async function resolveQuestion(action) {
    const buttons = form.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    setStatus(status, text('resolving'));
    const updates = {};
    inferredUpdates.forEach((update) => {
      const updateInputs = inputs.get(update.key);
      updates[update.key] = {
        entityId: updateInputs.entityId?.value || update.entityId || '',
        [update.kind === 'property' ? 'value' : 'targetId']: updateInputs.value.value,
      };
    });
    try {
      await postUnresolved(`/${question.id}/resolve`, {
        action,
        updates,
      });
      card.remove();
      if (!unresolvedList.children.length) unresolvedList.textContent = text('noUnresolved');
    } catch (error) {
      setStatus(status, error.message, 'error');
      buttons.forEach((button) => { button.disabled = false; });
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    resolveQuestion('accept');
  });
  form.querySelector('[data-action="reject"]').addEventListener('click', () => resolveQuestion('reject'));
  card.append(title, meta, form);
  return card;
}

async function loadUnresolvedQuestions() {
  if (!adminPassword) return;
  refreshUnresolvedBtn.disabled = true;
  setStatus(unresolvedStatus, '');
  try {
    const data = await postUnresolved();
    unresolvedList.innerHTML = '';
    if (!data.questions.length) {
      unresolvedList.textContent = text('noUnresolved');
      return;
    }
    data.questions.forEach((question) => unresolvedList.append(createUnresolvedCard(question)));
  } catch (error) {
    setStatus(unresolvedStatus, error.message, 'error');
  } finally {
    refreshUnresolvedBtn.disabled = false;
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  setStatus(authStatus, text('checking'));

  try {
    const data = await postStatus(password);
    adminPassword = password;
    setUnlocked(true);
    setStatus(
      authStatus,
      data.neo4jConfigured ? text('unlockedOk') : text('unlockedNoNeo4j'),
      data.neo4jConfigured ? 'success' : 'error'
    );
  } catch (error) {
    setUnlocked(false);
    setStatus(authStatus, error.message, 'error');
  }
});

refreshAnalyticsBtn.addEventListener('click', loadAnalytics);
refreshUnresolvedBtn.addEventListener('click', loadUnresolvedQuestions);
toggleAnalyticsViewBtn.addEventListener('click', () => {
  setAnalyticsView(analyticsView === 'summary' ? 'charts' : 'summary');
});
downloadAnalyticsBtn.addEventListener('click', async () => {
  try {
    await downloadAnalytics();
  } catch (error) {
    analyticsWarning.hidden = false;
    analyticsWarning.textContent = error.message;
  }
});

logoutBtn.addEventListener('click', () => {
  setUnlocked(false);
  setStatus(authStatus, text('loggedOut'));
  passwordInput.focus();
});

adminLanguage.addEventListener('change', () => {
  localStorage.setItem('guiaAdminLanguage', adminLanguage.value);
  applyTranslations();
  if (adminPassword && activeSection === 'analytics') {
    loadAnalytics();
  }
  if (adminPassword && activeSection === 'unresolved') {
    loadUnresolvedQuestions();
  }
});

document.querySelectorAll('[data-section-target]').forEach((button) => {
  button.addEventListener('click', () => showSection(button.dataset.sectionTarget));
});

document.querySelectorAll('.upload-card').forEach((card) => {
  const type = card.dataset.uploadType;
  const input = card.querySelector('input[type="file"]');
  const button = card.querySelector('button');
  const status = card.querySelector('.upload-status');

  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    card.classList.add('is-dragging');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('is-dragging');
  });

  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('is-dragging');
    if (event.dataTransfer.files.length) {
      input.files = event.dataTransfer.files;
      setStatus(status, `${text('ready')}: ${input.files[0].name}`);
    }
  });

  input.addEventListener('change', () => {
    setStatus(status, input.files.length ? `${text('ready')}: ${input.files[0].name}` : '');
  });

  button.addEventListener('click', async () => {
    if (!adminPassword) {
      setStatus(status, text('unlockFirst'), 'error');
      return;
    }
    if (!input.files.length) {
      setStatus(status, text('chooseFile'), 'error');
      return;
    }

    const formData = new FormData();
    formData.append('password', adminPassword);
    formData.append('file', input.files[0]);
    button.disabled = true;
    setStatus(status, text('uploading'));

    try {
      const response = await fetch(`/admin/api/upload/${type}`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Upload failed.');
      }
      setStatus(status, `${text('synced')} ${data.count} ${data.label} rows.`, 'success');
    } catch (error) {
      setStatus(status, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
});

adminLanguage.value = localStorage.getItem('guiaAdminLanguage') || 'en';
applyTranslations();
setAnalyticsView('summary');
