const API_BASE_URL = 'https://5fgkgol7v8.execute-api.us-east-1.amazonaws.com';
const TIMEOUT_MS = 10000;

let authToken = null;

function headers(extra = {}) {
  const base = {
    'Content-Type': 'application/json',
    ...extra
  };

  if (authToken) {
    base['Authorization'] = `Bearer ${authToken}`;
  }

  return base;
}

function withTimeout(fn, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  return fn(controller.signal)
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      if (err.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw err;
    });
}

async function handleJson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Request failed');
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return null;
}

export function setAuthToken(token) {
  authToken = token || null;
}

export function getAuthToken() {
  return authToken;
}

export async function createApplication() {
  return withTimeout((signal) =>
    fetch(`${API_BASE_URL}/applications`, {
      method: 'POST',
      headers: headers(),
      signal
    }).then(handleJson)
  );
}

export async function saveApplication(draft) {
  const payload = {
    status: draft.status,
    resumeKey: draft.resumeKey,
    answers: draft.answers || {},
    eeo: draft.eeo || {},
    createdAt: draft.createdAt,
    updatedAt: new Date().toISOString()
  };

  return withTimeout((signal) =>
    fetch(`${API_BASE_URL}/applications/${encodeURIComponent(draft.id)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(payload),
      signal
    }).then(handleJson)
  );
}

export async function submitApplication(draft) {
  const payload = {
    ...draft,
    status: 'SUBMITTED',
    submittedAt: new Date().toISOString()
  };
  return saveApplication(payload);
}

export async function getPresignedUpload(applicationId, file) {
  const presigned = await withTimeout((signal) =>
    fetch(`${API_BASE_URL}/upload-url`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        applicationId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream'
      }),
      signal
    }).then(handleJson)
  );

  return {
    ...presigned,
    url: presigned.url || presigned.uploadUrl,
    method: presigned.method || (presigned.fields ? 'POST' : 'PUT')
  };
}

export async function requestMagicLink(email) {
  return withTimeout((signal) =>
    fetch(`${API_BASE_URL}/magic-link`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email }),
      signal
    }).then(handleJson)
  );
}

export async function validateToken(token) {
  return withTimeout((signal) =>
    fetch(`${API_BASE_URL}/magic-link/validate`, {
      method: 'POST',
      headers: headers({ Authorization: `Bearer ${token}` }),
      signal
    }).then(handleJson)
  );
}

export async function uploadFile(file, presigned) {
  const method = presigned.method || 'PUT';
  const headersToUse = presigned.fields
    ? undefined
    : {
        'Content-Type': file.type || 'application/octet-stream'
      };

  const body = presigned.fields
    ? (() => {
        const form = new FormData();
        Object.entries(presigned.fields).forEach(([k, v]) => form.append(k, v));
        form.append('file', file);
        return form;
      })()
    : file;

  return withTimeout((signal) =>
    fetch(presigned.url, {
      method,
      headers: headersToUse,
      body,
      signal
    }).then((res) => {
      if (!res.ok) {
        throw new Error('Upload failed');
      }
      return true;
    })
  );
}
