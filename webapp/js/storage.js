const DRAFT_KEY = 'daylight-draft-v1';
const OUTBOX_KEY = 'daylight-outbox-v1';
const TOKEN_KEY = 'daylight-session-token';

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Unable to load draft', err);
    return null;
  }
}

export function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (err) {
    console.warn('Unable to save draft', err);
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    console.warn('Unable to clear draft', err);
  }
}

export function loadQueue() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Unable to load queue', err);
    return [];
  }
}

export function saveQueue(queue) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('Unable to save queue', err);
  }
}

export function storeSessionToken(token) {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch (err) {
    console.warn('Unable to store token', err);
  }
}

export function loadSessionToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch (err) {
    return null;
  }
}
