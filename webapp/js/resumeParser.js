const MAX_TEXT_SLICE = 280;

function cleanWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

async function parsePdf(file) {
  if (!window.pdfjsLib) {
    return file.text();
  }

  if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
  }

  return text;
}

async function parseDocx(file) {
  if (!window.JSZip) {
    return file.text();
  }

  const buffer = await file.arrayBuffer();
  const zip = await window.JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml').async('text');
  const stripped = docXml.replace(/<[^>]+>/g, ' ');
  return stripped;
}

export async function extractResumeText(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'pdf') return cleanWhitespace(await parsePdf(file));
    if (ext === 'docx' || ext === 'doc') return cleanWhitespace(await parseDocx(file));
    return cleanWhitespace(await file.text());
  } catch (err) {
    console.warn('Resume parse failed', err);
    try {
      return cleanWhitespace(await file.text());
    } catch (_) {
      return '';
    }
  }
}

export function mapResumeToAnswers(text) {
  const yearsMatch =
    text.match(/(\d{1,2})\s+(?:\+?\s*)?(?:years?|yrs?)\s+(?:of\s+)?experience/i) ||
    text.match(/(\d{1,2})\+?\s*(?:yrs|years)/i);
  const years = yearsMatch ? yearsMatch[1] : '';

  const lower = text.toLowerCase();
  const summaryKeywords = ['summary', 'objective', 'profile'];
  const stopKeywords =
    /(experience|employment|work history|education|skills|projects|certifications|contact)\b/i;

  let summaryText = '';
  for (const keyword of summaryKeywords) {
    const idx = lower.indexOf(keyword);
    if (idx !== -1) {
      const after = text.slice(idx + keyword.length);
      const stopAt = after.search(stopKeywords);
      summaryText = stopAt !== -1 ? after.slice(0, stopAt) : after;
      break;
    }
  }

  const sentences = (summaryText || text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s) &&
        !/\b(?:phone|tel|github|linkedin|portfolio)\b/i.test(s) &&
        !/\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/.test(s)
    );

  const summary = sentences.slice(0, 2).join(' ');
  const motivation = summary ? summary.slice(0, MAX_TEXT_SLICE) : '';

  return {
    motivation,
    years_experience: years,
    summary
  };
}
