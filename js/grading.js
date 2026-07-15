import { API_BASE, COMPANY_LABELS } from './config.js';
import { cropZoneThumbnail } from './imageTools.js';

export async function parseJsonResponse(res) {
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server did not return a valid response (HTTP ${res.status}). It may be starting up — try again in a moment.`);
  }
}

export async function analyzeCard(payload) {
  const res = await fetch(`${API_BASE}/analyze-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(data.error || 'Analyze request failed');
  return data;
}

function scoreClass(score) {
  if (score >= 9) return 'score--great';
  if (score >= 7.5) return 'score--good';
  if (score >= 6) return 'score--fair';
  return 'score--poor';
}

function subScoreCard(label, score, extra) {
  const el = document.createElement('div');
  el.className = 'subscore-card';
  el.innerHTML = `
    <div class="subscore-card__label">${label}</div>
    <div class="subscore-card__score ${scoreClass(score)}">${score.toFixed(1)}</div>
    ${extra ? `<div class="subscore-card__extra">${extra}</div>` : ''}
  `;
  return el;
}

function companyRow(key, data) {
  const el = document.createElement('div');
  el.className = 'company-row';
  el.innerHTML = `
    <span class="company-row__name">${COMPANY_LABELS[key]}</span>
    <span class="company-row__estimate">${Number(data.estimate).toFixed(1)}</span>
    <span class="company-row__confidence">(${Math.round(data.confidence)}%)</span>
  `;
  return el;
}

function defectItem(defect, imageSources) {
  const el = document.createElement('li');
  el.className = `defect-item defect-item--${defect.severity || 'minor'}`;

  const source = imageSources && imageSources[defect.side || 'front'];
  const thumbHtml = source
    ? `<img class="defect-item__thumb" src="${cropZoneThumbnail(source, defect.zone)}" alt="${defect.zone} area, circled approximately">`
    : '';

  el.innerHTML = `
    ${thumbHtml}
    <div class="defect-item__text">
      <span class="defect-item__category">${defect.category}</span>
      <span class="defect-item__location">${defect.location}</span>
      <span class="defect-item__desc">${defect.description}</span>
      ${source ? '<span class="defect-item__approx">circle = approximate area only</span>' : ''}
    </div>
  `;
  return el;
}

// Renders the full results dashboard (sub-scores, company table, defects,
// disclaimer) into `container`. `imageSources` (optional) is
// `{ front, back }`, each a canvas or loaded <img> for the corresponding
// full card photo — when provided, each defect gets a cropped, circled
// thumbnail of its approximate zone.
export function renderResultsDashboard(container, result, imageSources) {
  container.innerHTML = '';
  container.className = 'results-dashboard';

  const subScores = document.createElement('div');
  subScores.className = 'results-dashboard__subscores';
  subScores.appendChild(subScoreCard('Centering', result.centering.score,
    `L/R+T/B worst: ${result.centering.front_ratio} front · ${result.centering.back_ratio} back`));
  subScores.appendChild(subScoreCard('Corners', result.corners_score));
  subScores.appendChild(subScoreCard('Surface', result.surface_score));
  subScores.appendChild(subScoreCard('Edges', result.edges_score));
  container.appendChild(subScores);

  if (result.summary) {
    const summary = document.createElement('p');
    summary.className = 'results-dashboard__summary';
    summary.textContent = result.summary;
    container.appendChild(summary);
  }

  const companyBlock = document.createElement('div');
  companyBlock.className = 'company-table';
  const companyTitle = document.createElement('h3');
  companyTitle.textContent = 'Estimated grade by company';
  companyBlock.appendChild(companyTitle);
  ['psa', 'cgc', 'bgs', 'tag'].forEach((key) => {
    companyBlock.appendChild(companyRow(key, result.companies[key]));
  });
  container.appendChild(companyBlock);

  if (result.defects && result.defects.length) {
    const defectsBlock = document.createElement('div');
    defectsBlock.className = 'defects-block';
    const title = document.createElement('h3');
    title.textContent = `Flaws noted (${result.defects.length})`;
    defectsBlock.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'defects-list';
    result.defects.forEach((d) => list.appendChild(defectItem(d, imageSources)));
    defectsBlock.appendChild(list);
    container.appendChild(defectsBlock);
  }

  const disclaimer = document.createElement('p');
  disclaimer.className = 'disclaimer';
  disclaimer.textContent = 'AI pre-grade estimate for personal reference only — not affiliated with PSA, CGC, BGS, or TAG, and not a guarantee of actual submission results. Physical handling can reveal flaws a photo cannot.';
  container.appendChild(disclaimer);
}
