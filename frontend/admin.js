const authForm = document.querySelector('#auth-form');
const passwordInput = document.querySelector('#admin-password');
const authStatus = document.querySelector('#auth-status');
const uploadGrid = document.querySelector('#upload-grid');
const instructions = document.querySelector('#instructions');
const analyticsPanel = document.querySelector('#analytics-panel');
const refreshAnalyticsBtn = document.querySelector('#refresh-analytics');
const analyticsWarning = document.querySelector('#analytics-warning');
const analyticsPath = document.querySelector('#analytics-path');

let adminPassword = '';

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
    target.textContent = 'No data yet';
    return;
  }

  entries.forEach(([label, count]) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.innerHTML = `<span>${label}</span><strong>${count}</strong>`;
    target.append(pill);
  });
}

function renderAnalytics(analytics) {
  const totals = analytics?.totals || {};
  document.querySelector('#metric-visits').textContent = totals.visits || 0;
  document.querySelector('#metric-questions').textContent = totals.questions || 0;
  document.querySelector('#metric-locations').textContent = totals.locations || 0;
  document.querySelector('#metric-avg-chars').textContent = analytics?.questionChars?.avg || 0;
  analyticsPath.textContent = `Source: ${analytics?.path || 'analytics/sessions.jsonl'}`;

  analyticsWarning.hidden = !!analytics?.enabled;
  analyticsWarning.textContent = analytics?.enabled
    ? ''
    : 'Analytics are currently disabled. Set GUIA_ANALYTICS_ENABLED=true in the Space secrets to record new sessions.';

  renderCounter('#analytics-languages', analytics?.languages);
  renderCounter('#analytics-ages', analytics?.ages);
  renderCounter('#analytics-personas', analytics?.personas);
  renderCounter('#analytics-preferences', analytics?.preferences);
  renderCounter('#analytics-rooms', analytics?.rooms);

  const tbody = document.querySelector('#recent-visits-body');
  tbody.innerHTML = '';
  const visits = analytics?.recentVisits || [];
  if (!visits.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="7">No sessions recorded yet.</td>';
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

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  setStatus(authStatus, 'Checking access...');

  try {
    const data = await postStatus(password);
    adminPassword = password;
    uploadGrid.hidden = false;
    analyticsPanel.hidden = false;
    instructions.hidden = false;
    setStatus(
      authStatus,
      data.neo4jConfigured ? 'Unlocked. Neo4j is configured.' : 'Unlocked, but Neo4j secrets are incomplete.',
      data.neo4jConfigured ? 'success' : 'error'
    );
    loadAnalytics();
  } catch (error) {
    adminPassword = '';
    uploadGrid.hidden = true;
    analyticsPanel.hidden = true;
    instructions.hidden = true;
    setStatus(authStatus, error.message, 'error');
  }
});

refreshAnalyticsBtn.addEventListener('click', loadAnalytics);

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
      setStatus(status, `Ready: ${input.files[0].name}`);
    }
  });

  input.addEventListener('change', () => {
    setStatus(status, input.files.length ? `Ready: ${input.files[0].name}` : '');
  });

  button.addEventListener('click', async () => {
    if (!adminPassword) {
      setStatus(status, 'Unlock the portal first.', 'error');
      return;
    }
    if (!input.files.length) {
      setStatus(status, 'Choose a file to upload.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('password', adminPassword);
    formData.append('file', input.files[0]);
    button.disabled = true;
    setStatus(status, 'Uploading and syncing...');

    try {
      const response = await fetch(`/admin/api/upload/${type}`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Upload failed.');
      }
      setStatus(status, `Synced ${data.count} ${data.label} rows.`, 'success');
    } catch (error) {
      setStatus(status, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
});
