// DOM helpers
const dom = {
  byId: new Map(),

  id(id) {
    if (!this.byId.has(id)) {
      this.byId.set(id, document.getElementById(id));
    }
    return this.byId.get(id);
  },

  q(selector, root = document) {
    return root.querySelector(selector);
  },

  qa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  },

  clearCache() {
    this.byId.clear();
  }
};

function el(id) {
  return dom.id(id);
}

function q(selector, root = document) {
  return dom.q(selector, root);
}

function qa(selector, root = document) {
  return dom.qa(selector, root);
}

function setText(node, text) {
  if (node) node.textContent = text;
}

function setAttribute(node, name, value) {
  if (node) node.setAttribute(name, value);
}

function announce(message) {
  const status = el('sr-status');
  if (!status || !message) return;
  status.textContent = '';
  window.setTimeout(() => {
    status.textContent = message;
  }, 20);
}

function focusFirstAvailable(root) {
  const target = q(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root
  );
  target?.focus?.();
}
