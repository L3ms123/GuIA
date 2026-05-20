// General helpers

function selectRadio(buttons, clicked) {
  buttons.forEach((b) => {
    const selected = b === clicked;
    b.setAttribute('aria-checked', selected ? 'true' : 'false');
    b.setAttribute('tabindex', '0');
  });
}

function initEnterToggleCheckboxes() {
  qa('.toggle-row input[type="checkbox"]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.click();
    });
  });
}

function enableSelectEnterOpen(select) {
  select?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    if (typeof select.showPicker === 'function') {
      event.preventDefault();
      try {
        select.showPicker();
      } catch (err) {
        select.click();
      }
      return;
    }

    select.click();
  });
}

function initRadioGroupKeyboard(groupSelector, buttonSelector) {
  const group = q(groupSelector);
  if (!group) return;

  group.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      const active = document.activeElement;
      if (active?.matches?.(buttonSelector)) {
        event.preventDefault();
        active.click();
      }
      return;
    }

    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const buttons = qa(buttonSelector, group).filter((button) => !button.disabled);
    if (!buttons.length) return;

    event.preventDefault();

    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1;
    }

    buttons[nextIndex].focus();
    buttons[nextIndex].click();
  });
}

function setBubbleSource(bubble, text, lang = state.selectedLang) {
  if (!bubble || !text?.trim()) return;
  bubble.dataset.originalText = text.trim();
  bubble.dataset.originalLang = lang || state.selectedLang || DEFAULT_LANGUAGE;
}

function getBubbleText(bubble) {
  if (!bubble) return '';
  const clone = bubble.cloneNode(true);
  clone.querySelectorAll('.bubble-speaker').forEach((node) => node.remove());
  return clone.textContent.trim();
}

function setBubbleText(bubble, text, role = bubble?.dataset.role || 'assistant') {
  if (!bubble) return;
  bubble.textContent = '';
  const speaker = document.createElement('span');
  speaker.className = 'sr-only bubble-speaker';
  speaker.textContent = role === 'user'
    ? `${t('chat.userMessageLabel', 'You')}: `
    : `${t('chat.assistantMessageLabel', 'GuIA')}: `;
  bubble.appendChild(speaker);
  bubble.appendChild(document.createTextNode(text || ''));
}

function addBubble(role, text, options = {}) {
  const chatThread = el('chat-thread');
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${role === 'user' ? 'user-bubble' : 'assistant-bubble'}`;
  bubble.dataset.role = role;
  bubble.dataset.messageLang = options.lang || state.selectedLang || DEFAULT_LANGUAGE;
  bubble.tabIndex = 0;
  setBubbleText(bubble, text, role);
  setBubbleSource(bubble, options.sourceText ?? text, options.sourceLang || bubble.dataset.messageLang);
  updateBubbleAccessibilityLabel(bubble, role);
  row.appendChild(bubble);
  chatThread.appendChild(row);
  chatThread.scrollTop = chatThread.scrollHeight;
  return bubble;
}

function updateBubbleAccessibilityLabel(bubble, role) {
  if (!bubble) return;
  const currentText = getBubbleText(bubble);
  setBubbleText(bubble, currentText, role);
}

function easyWordAnnotationsEnabled() {
  return state.accessibilityPrefs.simpleLanguage;
}

async function annotateEasyWords(bubble) {
  if (!bubble || !easyWordAnnotationsEnabled()) return;

  const text = getBubbleText(bubble);
  if (!text) return;

  try {
    const res = await fetch(API_ENDPOINTS.easyWords, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: state.selectedLang })
    });

    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.rewritten_text === 'string' && data.rewritten_text.trim()) {
      setBubbleText(bubble, data.rewritten_text.trim(), 'assistant');
      setBubbleSource(bubble, getBubbleText(bubble), state.selectedLang);
      bubble.dataset.messageLang = state.selectedLang;
      updateBubbleAccessibilityLabel(bubble, 'assistant');
      return;
    }

    const annotations = Array.isArray(data.annotations) ? data.annotations : [];
    if (!annotations.length) return;

    renderAnnotatedText(bubble, text, annotations);
  } catch (err) {
    console.warn('Could not annotate easy words:', err);
  }
}

function renderAnnotatedText(container, text, annotations) {
  const byWord = new Map();
  annotations.forEach((item) => {
    const word = (item.word || '').trim().toLowerCase();
    if (!word || byWord.has(word)) return;
    byWord.set(word, item);
  });

  if (!byWord.size) return;

  const pattern = new RegExp(`\\b(${[...byWord.keys()].map(escapeRegExp).join('|')})\\b`, 'giu');
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const item = byWord.get(match[0].toLowerCase());
    const span = document.createElement('span');
    span.className = 'easy-word';
    span.textContent = item.replacement || match[0];
    const label = item.replacement ? `${match[0]}: ${item.definition}` : item.definition;
    span.title = label;
    span.setAttribute('aria-label', label);
    span.tabIndex = 0;
    fragment.appendChild(span);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  container.textContent = '';
  const speaker = document.createElement('span');
  speaker.className = 'sr-only bubble-speaker';
  speaker.textContent = `${t('chat.assistantMessageLabel', 'GuIA')}: `;
  container.appendChild(speaker);
  container.appendChild(fragment);
  setBubbleSource(container, getBubbleText(container), state.selectedLang);
  container.dataset.messageLang = state.selectedLang;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
