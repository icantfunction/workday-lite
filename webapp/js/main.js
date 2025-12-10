import {
  createApplication,
  saveApplication,
  submitApplication,
  getPresignedUpload,
  uploadFile,
  setAuthToken,
  validateToken,
  requestMagicLink,
  getAuthToken
} from './api.js';
import {
  loadDraft,
  saveDraft,
  clearDraft,
  loadQueue,
  saveQueue,
  loadSessionToken,
  storeSessionToken
} from './storage.js';
import { extractResumeText, mapResumeToAnswers } from './resumeParser.js';

const steps = ['resume', 'questions', 'eeo', 'review'];
const AUTOSAVE_DELAY = 600;

let draft = null;
let outbox = [];
let currentStepIndex = 0;
let autosaveTimer = null;
let online = navigator.onLine;

const dom = {
  stepLabel: document.getElementById('step-label'),
  statusText: document.getElementById('status-text'),
  errorText: document.getElementById('error-text'),
  progressBar: document.getElementById('progress-bar'),
  stepperItems: Array.from(document.querySelectorAll('[data-step-marker]')),
  stepResume: document.getElementById('step-resume'),
  stepQuestions: document.getElementById('step-questions'),
  stepEeo: document.getElementById('step-eeo'),
  stepReview: document.getElementById('step-review'),
  resumeInput: document.getElementById('resume-input'),
  resumeInfo: document.getElementById('resume-info'),
  qMotivation: document.getElementById('q-motivation'),
  qYears: document.getElementById('q-years'),
  eeoGender: document.getElementById('eeo-gender'),
  eeoVeteran: document.getElementById('eeo-veteran'),
  reviewResume: document.getElementById('review-resume'),
  reviewQuestions: document.getElementById('review-questions'),
  reviewEeo: document.getElementById('review-eeo'),
  backBtn: document.getElementById('back-btn'),
  nextBtn: document.getElementById('next-btn'),
  submitBtn: document.getElementById('submit-btn'),
  offlineBanner: document.getElementById('offline-banner'),
  queuePill: document.getElementById('queue-pill'),
  pendingResume: document.getElementById('pending-resume'),
  pendingResumeName: document.getElementById('pending-resume-name'),
  resumeRetryBtn: document.getElementById('resume-retry-btn'),
  magicForm: document.getElementById('magic-form'),
  magicEmail: document.getElementById('magic-email'),
  magicStatus: document.getElementById('magic-status')
};

function currentStep() {
  return steps[currentStepIndex];
}

function setStatus(text, saving) {
  dom.statusText.textContent = text;
  dom.statusText.classList.toggle('saving', Boolean(saving));
  dom.statusText.classList.toggle('small', Boolean(saving));
}

function setError(text) {
  dom.errorText.textContent = text || '';
  dom.errorText.classList.toggle('hidden', !text);
}

function setMagicStatus(text, variant = 'neutral') {
  if (!dom.magicStatus) return;
  if (!text) {
    dom.magicStatus.textContent = '';
    dom.magicStatus.classList.add('hidden');
    return;
  }
  dom.magicStatus.textContent = text;
  dom.magicStatus.classList.remove('hidden');
  dom.magicStatus.classList.remove('neutral', 'success', 'error');
  dom.magicStatus.classList.add(variant);
}

function renderQueue() {
  if (!dom.queuePill) return;
  const count = outbox.length;
  dom.queuePill.classList.toggle('hidden', count === 0);
  if (count > 0) {
    dom.queuePill.textContent = `${count} pending sync`;
  }
}

function persistLocal() {
  if (!draft) return;
  saveDraft(draft);
}

function setOnlineState(isOnline) {
  online = isOnline;
  dom.offlineBanner?.classList.toggle('visible', !online);
  dom.statusText.classList.toggle('live', online);
  dom.statusText.classList.toggle('ghost', !online);
  if (!online) {
    setStatus('Offline draft saved locally', false);
  }
  updatePendingResumeUI();
  updateButtons();
}

function updatePendingResumeUI() {
  if (!dom.pendingResume) return;
  const pending = Boolean(draft && draft.pendingResumeName && !draft.resumeKey);
  dom.pendingResume.classList.toggle('visible', pending);
  if (pending && dom.pendingResumeName) {
    dom.pendingResumeName.textContent = draft.pendingResumeName;
  }
}

function enqueueAction(type) {
  outbox = outbox.filter((item) => item.type !== type);
  outbox.push({ type, at: Date.now() });
  saveQueue(outbox);
  renderQueue();
}

async function ensureRemoteDraft() {
  if (!draft || !draft.needsBootstrap || !online) return;
  const created = await createApplication();
  draft = {
    ...created,
    answers: draft.answers || created.answers || {},
    eeo: draft.eeo || created.eeo || {},
    status: draft.status || 'DRAFT'
  };
  draft.needsBootstrap = false;
  persistLocal();
}

async function flushQueue() {
  if (!online || !outbox.length) return;

  try {
    await ensureRemoteDraft();
  } catch (err) {
    console.warn('Bootstrap failed', err);
    setStatus('Offline draft saved locally', false);
    return;
  }

  while (outbox.length) {
    const next = outbox[0];
    try {
      if (next.type === 'save') {
        const updated = await saveApplication(draft);
        draft = { ...draft, ...updated };
      } else if (next.type === 'submit') {
        const updated = await submitApplication(draft);
        draft = { ...draft, ...updated };
      }
      persistLocal();
      outbox.shift();
      saveQueue(outbox);
      renderQueue();
      setStatus('All changes saved', false);
      setError('');
    } catch (err) {
      console.warn('Flush failed', err);
      setStatus('Working offline (queued)', false);
      setError('Sync queued. We will retry when back online.');
      return;
    }
  }
}

function scheduleSave() {
  if (!draft) return;
  persistLocal();
  enqueueAction('save');
  setStatus(online ? 'Saving...' : 'Offline draft saved locally', true);
  setError('');

  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  autosaveTimer = setTimeout(() => {
    flushQueue();
  }, AUTOSAVE_DELAY);
}

function updateStepLabel() {
  if (!draft) {
    dom.stepLabel.textContent = 'Loading...';
    return;
  }
  dom.stepLabel.textContent = `Step ${currentStepIndex + 1}/${steps.length} | Status: ${draft.status || 'DRAFT'}`;
}

function updateStepper() {
  dom.stepperItems.forEach((item, idx) => {
    item.classList.toggle('is-active', idx === currentStepIndex);
    item.classList.toggle('is-complete', idx < currentStepIndex);
  });
}

function updateProgressBar() {
  const percent = ((currentStepIndex + 1) / steps.length) * 100;
  dom.progressBar.style.width = `${percent}%`;
  updateStepper();
}

function hasResume() {
  return Boolean(draft && (draft.resumeKey || draft.pendingResumeName));
}

function updateButtons() {
  dom.backBtn.disabled = currentStepIndex === 0;

  if (currentStepIndex === steps.length - 1) {
    dom.nextBtn.classList.add('hidden');
    dom.submitBtn.classList.remove('hidden');
  } else {
    dom.nextBtn.classList.remove('hidden');
    dom.submitBtn.classList.add('hidden');
  }

  if (currentStep() === 'resume' && !hasResume()) {
    dom.nextBtn.disabled = true;
  } else {
    dom.nextBtn.disabled = false;
  }
}

function syncReview() {
  if (!draft) return;
  const answers = draft.answers || {};
  const eeo = draft.eeo || {};

  dom.reviewResume.textContent =
    draft.resumeKey || draft.pendingResumeName || 'Resume pending upload (required for submit)';
  dom.reviewQuestions.textContent = `Motivation: ${answers.motivation || 'Not answered'}\nYears of experience: ${
    answers.years_experience || 'Not provided'
  }`;
  dom.reviewEeo.textContent = `Gender: ${eeo.gender || 'Not shared'}\nVeteran status: ${eeo.veteran || 'Not shared'}`;
}

function showCurrentStep() {
  const stepName = currentStep();

  [dom.stepResume, dom.stepQuestions, dom.stepEeo, dom.stepReview].forEach((el) => {
    el.classList.remove('visible');
  });

  if (stepName === 'resume') dom.stepResume.classList.add('visible');
  if (stepName === 'questions') dom.stepQuestions.classList.add('visible');
  if (stepName === 'eeo') dom.stepEeo.classList.add('visible');
  if (stepName === 'review') {
    dom.stepReview.classList.add('visible');
    syncReview();
  }

  updateStepLabel();
  updateProgressBar();
  updateButtons();
}

function hydrateFormFromDraft() {
  if (!draft) return;

  if (draft.resumeKey) {
    dom.resumeInfo.textContent = 'Resume uploaded.';
  } else if (draft.pendingResumeName) {
    dom.resumeInfo.textContent = `${draft.pendingResumeName} ready to upload when online.`;
  }

  if (draft.answers) {
    if (draft.answers.motivation) dom.qMotivation.value = draft.answers.motivation;
    if (draft.answers.years_experience) dom.qYears.value = draft.answers.years_experience;
  }

  if (draft.eeo) {
    if (draft.eeo.gender) dom.eeoGender.value = draft.eeo.gender;
    if (draft.eeo.veteran) dom.eeoVeteran.value = draft.eeo.veteran;
  }

  updatePendingResumeUI();
}

async function handleResumeUpload(file) {
  if (!file || !draft) return;

  dom.resumeInfo.textContent = 'Reading resume locally...';
  setError('');

  try {
    const text = await extractResumeText(file);
    const suggestions = mapResumeToAnswers(text);

    if (suggestions.motivation && !dom.qMotivation.value) {
      draft.answers = draft.answers || {};
      draft.answers.motivation = suggestions.motivation;
      dom.qMotivation.value = suggestions.motivation;
    }

    if (suggestions.years_experience && !dom.qYears.value) {
      draft.answers = draft.answers || {};
      draft.answers.years_experience = suggestions.years_experience;
      dom.qYears.value = suggestions.years_experience;
    }

    if (suggestions.summary) {
      dom.resumeInfo.textContent = `Autofilled from resume. Summary: ${suggestions.summary.slice(0, 120)}${
        suggestions.summary.length > 120 ? '...' : ''
      }`;
    } else {
      dom.resumeInfo.textContent = 'Autofilled from resume text.';
    }

    scheduleSave();
  } catch (err) {
    console.warn('Parsing failed', err);
    dom.resumeInfo.textContent = 'Could not parse resume. You can still upload it.';
  }

  if (!online || draft.needsBootstrap) {
    draft.pendingResumeName = file.name;
    scheduleSave();
    updatePendingResumeUI();
    updateButtons();
    return;
  }

  dom.resumeInfo.textContent = 'Uploading resume...';
  try {
    const presigned = await getPresignedUpload(draft.id, file);
    const uploadTarget = presigned.url || presigned.uploadUrl;
    await uploadFile(file, { ...presigned, url: uploadTarget });

    draft.resumeKey = presigned.key || presigned.uploadKey || file.name;
    draft.pendingResumeName = null;
    dom.resumeInfo.textContent = `Uploaded: ${file.name}`;
    scheduleSave();
  } catch (err) {
    console.error(err);
    draft.pendingResumeName = file.name;
    dom.resumeInfo.textContent = 'Upload failed. We will retry when online.';
    setError('Resume upload failed. Check your connection and try again.');
    scheduleSave();
  }

  updatePendingResumeUI();
  updateButtons();
}

function hookEvents() {
  dom.backBtn.addEventListener('click', () => {
    if (currentStepIndex > 0) {
      currentStepIndex -= 1;
      showCurrentStep();
    }
  });

  dom.nextBtn.addEventListener('click', () => {
    if (currentStepIndex < steps.length - 1) {
      currentStepIndex += 1;
      showCurrentStep();
    }
  });

  dom.submitBtn.addEventListener('click', async () => {
    if (!draft) return;

    if (!draft.resumeKey) {
      setError('Please upload your resume before submitting.');
      return;
    }

    draft.status = 'SUBMITTED';
    enqueueAction('submit');
    setStatus('Submitting...', true);

    await flushQueue();

    if (draft.status === 'SUBMITTED' && !outbox.length) {
      alert('Application submitted!');
      clearDraft();
      saveQueue([]);
      outbox = [];
      renderQueue();
      setStatus('Submitted', false);
    } else {
      setStatus('Queued for submission when online', false);
      setError('We will submit automatically once you are back online.');
    }
  });

  dom.resumeInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    await handleResumeUpload(file);
  });

  dom.resumeRetryBtn?.addEventListener('click', () => {
    dom.resumeInput?.click();
  });

  dom.qMotivation.addEventListener('blur', () => {
    if (!draft) return;
    draft.answers = draft.answers || {};
    draft.answers.motivation = dom.qMotivation.value;
    scheduleSave();
  });

  dom.qYears.addEventListener('blur', () => {
    if (!draft) return;
    draft.answers = draft.answers || {};
    draft.answers.years_experience = dom.qYears.value;
    scheduleSave();
  });

  dom.eeoGender.addEventListener('change', () => {
    if (!draft) return;
    draft.eeo = draft.eeo || {};
    draft.eeo.gender = dom.eeoGender.value;
    scheduleSave();
  });

  dom.eeoVeteran.addEventListener('change', () => {
    if (!draft) return;
    draft.eeo = draft.eeo || {};
    draft.eeo.veteran = dom.eeoVeteran.value;
    scheduleSave();
  });

  dom.magicForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (dom.magicEmail?.value || '').trim();
    if (!email) {
      setMagicStatus('Enter an email', 'error');
      return;
    }
    setMagicStatus('Sending link...', 'neutral');
    try {
      await requestMagicLink(email);
      setMagicStatus('Link sent. Check your email.', 'success');
    } catch (err) {
      console.warn('Magic link request failed', err);
      setMagicStatus('Could not send link. Try again.', 'error');
    }
  });
}

function registerConnectivityHandlers() {
  window.addEventListener('online', () => {
    setOnlineState(true);
    validateSessionToken();
    flushQueue();
  });

  window.addEventListener('offline', () => {
    setOnlineState(false);
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('Service worker registration failed', err);
  });
}

function initToken() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  const stored = loadSessionToken();
  const token = urlToken || stored;
  if (token) {
    setAuthToken(token);
    storeSessionToken(token);
    setMagicStatus('Magic link active', 'success');
  }
}

async function validateSessionToken() {
  const token = getAuthToken();
  if (!token) return;
  try {
    await validateToken(token);
    setMagicStatus('Magic link active', 'success');
  } catch (err) {
    console.warn('Token validation failed', err);
    setMagicStatus('Link expired. Request a new one.', 'error');
  }
}

async function bootstrapDraft() {
  setStatus('Initializing...', false);
  setError('');

  draft = loadDraft();
  outbox = loadQueue();
  renderQueue();

  if (!draft) {
    try {
      const created = await createApplication();
      draft = {
        ...created,
        answers: created.answers || {},
        eeo: created.eeo || {},
        status: created.status || 'DRAFT'
      };
      persistLocal();
    } catch (err) {
      console.warn('Unable to create remote draft, starting offline', err);
      draft = {
        id: `local-${Date.now()}`,
        status: 'DRAFT',
        answers: {},
        eeo: {},
        createdAt: new Date().toISOString(),
        needsBootstrap: true
      };
      persistLocal();
      enqueueAction('save');
    }
  }
}

async function init() {
  initToken();
  if (getAuthToken()) {
    if (navigator.onLine) {
      await validateSessionToken();
    } else {
      setMagicStatus('Magic link cached (offline)', 'neutral');
    }
  }
  await bootstrapDraft();
  hydrateFormFromDraft();
  hookEvents();
  setOnlineState(navigator.onLine);
  registerConnectivityHandlers();
  registerServiceWorker();
  setStatus('Ready. Autosaving.', false);
  showCurrentStep();
  flushQueue();
}

init();
