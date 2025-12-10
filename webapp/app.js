const API_BASE_URL = 'https://5fgkgol7v8.execute-api.us-east-1.amazonaws.com';
const LOCAL_KEY = 'workday-lite-application-draft';

const steps = ['resume', 'questions', 'eeo', 'review'];
let currentStepIndex = 0;
let draft = null;
let saveTimeout = null;

// DOM references
const stepLabelEl = document.getElementById('step-label');
const statusTextEl = document.getElementById('status-text');
const errorTextEl = document.getElementById('error-text');
const progressBarEl = document.getElementById('progress-bar');

const stepResumeEl = document.getElementById('step-resume');
const stepQuestionsEl = document.getElementById('step-questions');
const stepEeoEl = document.getElementById('step-eeo');
const stepReviewEl = document.getElementById('step-review');

const resumeInputEl = document.getElementById('resume-input');
const resumeInfoEl = document.getElementById('resume-info');

const qMotivationEl = document.getElementById('q-motivation');
const qYearsEl = document.getElementById('q-years');

const eeoGenderEl = document.getElementById('eeo-gender');
const eeoVeteranEl = document.getElementById('eeo-veteran');

const reviewResumeEl = document.getElementById('review-resume');
const reviewQuestionsEl = document.getElementById('review-questions');
const reviewEeoEl = document.getElementById('review-eeo');

const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
const submitBtn = document.getElementById('submit-btn');

// Helpers
function setStatus(text, saving) {
  statusTextEl.textContent = text;
  if (saving) {
    statusTextEl.classList.add('small');
  } else {
    statusTextEl.classList.remove('small');
  }
}

function setError(text) {
  errorTextEl.textContent = text || '';
}

function saveToLocal() {
  if (!draft) return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(draft));
  } catch (e) {
    console.warn('localStorage failed', e);
  }
}

function scheduleSave() {
  if (!draft) return;
  saveToLocal();
  setStatus('Saving…', true);
  setError('');

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(async () => {
    try {
      await apiSaveApplication(draft);
      setStatus('All changes saved', false);
    } catch (e) {
      console.error(e);
      setStatus('Working offline (local draft saved)', false);
      setError('Autosave failed. Your changes are safe locally; check your connection.');
    }
  }, 800);
}

function currentStep() {
  return steps[currentStepIndex];
}

function updateStepLabel() {
  if (!draft) {
    stepLabelEl.textContent = 'Loading…';
    return;
  }
  const stepNumber = currentStepIndex + 1;
  stepLabelEl.textContent = `Step ${stepNumber} of ${steps.length} · Status: ${draft.status}`;
}

function updateProgressBar() {
  const percent = ((currentStepIndex + 1) / steps.length) * 100;
  progressBarEl.style.width = `${percent}%`;
}

function updateButtons() {
  backBtn.disabled = currentStepIndex === 0;

  if (currentStepIndex === steps.length - 1) {
    nextBtn.classList.add('hidden');
    submitBtn.classList.remove('hidden');
  } else {
    nextBtn.classList.remove('hidden');
    submitBtn.classList.add('hidden');
  }

  // require resume before moving on
  if (currentStep() === 'resume' && (!draft || !draft.resumeKey)) {
    nextBtn.disabled = true;
  } else {
    nextBtn.disabled = false;
  }
}

function syncReview() {
  if (!draft) return;
  reviewResumeEl.textContent = draft.resumeKey || 'Not uploaded';
  reviewQuestionsEl.textContent = JSON.stringify(draft.answers || {}, null, 2);
  reviewEeoEl.textContent = JSON.stringify(draft.eeo || {}, null, 2);
}

function showCurrentStep() {
  const stepName = currentStep();

  [stepResumeEl, stepQuestionsEl, stepEeoEl, stepReviewEl].forEach((el) => {
    el.classList.remove('visible');
  });

  if (stepName === 'resume') stepResumeEl.classList.add('visible');
  if (stepName === 'questions') stepQuestionsEl.classList.add('visible');
  if (stepName === 'eeo') stepEeoEl.classList.add('visible');
  if (stepName === 'review') {
    stepReviewEl.classList.add('visible');
    syncReview();
  }

  updateStepLabel();
  updateProgressBar();
  updateButtons();
}

// API calls
async function apiCreateApplication() {
  const res = await fetch(`${API_BASE_URL}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    throw new Error('Failed to create application');
  }
  return res.json();
}

async function apiSaveApplication(d) {
  const payload = {
    status: d.status,
    resumeKey: d.resumeKey,
    answers: d.answers || {},
    eeo: d.eeo || {},
    createdAt: d.createdAt
  };

  const res = await fetch(`${API_BASE_URL}/applications/${encodeURIComponent(d.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error('Failed to save application');
  }

  const updated = await res.json();
  draft = {
    ...draft,
    ...updated
  };
  saveToLocal();
  return updated;
}

async function apiGetUploadUrl(applicationId, file) {
  const res = await fetch(`${API_BASE_URL}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      applicationId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream'
    })
  });

  if (!res.ok) {
    throw new Error('Failed to get upload URL');
  }

  return res.json();
}

// Event handlers
function hookEvents() {
  backBtn.addEventListener('click', () => {
    if (currentStepIndex > 0) {
      currentStepIndex -= 1;
      showCurrentStep();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentStepIndex < steps.length - 1) {
      currentStepIndex += 1;
      showCurrentStep();
    }
  });

  submitBtn.addEventListener('click', async () => {
    if (!draft) return;
    draft.status = 'SUBMITTED';
    scheduleSave();
    alert('Application submitted!');
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch (e) {
      console.warn('Could not clear local storage', e);
    }
    setStatus('Submitted', false);
  });

  resumeInputEl.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !draft) return;

    resumeInfoEl.textContent = 'Uploading resume…';
    setError('');

    try {
      const { uploadUrl, key } = await apiGetUploadUrl(draft.id, file);
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
      });

      if (!putRes.ok) {
        throw new Error('Upload failed');
      }

      draft.resumeKey = key;
      resumeInfoEl.textContent = `Uploaded: ${file.name}`;
      scheduleSave();
    } catch (err) {
      console.error(err);
      resumeInfoEl.textContent = 'Upload failed. You can retry.';
      setError('Resume upload failed. Check your connection and try again.');
    }

    updateButtons();
  });

  qMotivationEl.addEventListener('blur', () => {
    if (!draft) return;
    draft.answers = draft.answers || {};
    draft.answers.motivation = qMotivationEl.value;
    scheduleSave();
  });

  qYearsEl.addEventListener('blur', () => {
    if (!draft) return;
    draft.answers = draft.answers || {};
    draft.answers.years_experience = qYearsEl.value;
    scheduleSave();
  });

  eeoGenderEl.addEventListener('change', () => {
    if (!draft) return;
    draft.eeo = draft.eeo || {};
    draft.eeo.gender = eeoGenderEl.value;
    scheduleSave();
  });

  eeoVeteranEl.addEventListener('change', () => {
    if (!draft) return;
    draft.eeo = draft.eeo || {};
    draft.eeo.veteran = eeoVeteranEl.value;
    scheduleSave();
  });
}

// Init
async function init() {
  setStatus('Initializing…', false);
  setError('');

  // try local draft first
  try {
    const stored = localStorage.getItem(LOCAL_KEY);
    if (stored) {
      draft = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Unable to read local draft', e);
  }

  if (!draft) {
    try {
      const created = await apiCreateApplication();
      draft = {
        ...created,
        answers: created.answers || {},
        eeo: created.eeo || {}
      };
      saveToLocal();
    } catch (e) {
      console.error(e);
      setStatus('Offline. Could not reach server.', false);
      setError('Could not start application. Refresh when you are back online.');
      return;
    }
  }

  // hydrate UI from draft
  if (draft.resumeKey) {
    resumeInfoEl.textContent = 'Resume uploaded.';
  }

  if (draft.answers) {
    if (draft.answers.motivation) {
      qMotivationEl.value = draft.answers.motivation;
    }
    if (draft.answers.years_experience) {
      qYearsEl.value = draft.answers.years_experience;
    }
  }

  if (draft.eeo) {
    if (draft.eeo.gender) {
      eeoGenderEl.value = draft.eeo.gender;
    }
    if (draft.eeo.veteran) {
      eeoVeteranEl.value = draft.eeo.veteran;
    }
  }

  hookEvents();
  setStatus('All changes saved', false);
  showCurrentStep();
}

init();
