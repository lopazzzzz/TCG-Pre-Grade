import { t } from './i18n.js';

export function initDonateCopyButton() {
  const btn = document.getElementById('copy-account-btn');
  const numberEl = document.getElementById('donate-account-number');
  if (!btn || !numberEl) return;

  btn.addEventListener('click', async () => {
    const raw = numberEl.dataset.raw || numberEl.textContent.replace(/-/g, '');
    try {
      await navigator.clipboard.writeText(raw);
      const original = btn.textContent;
      btn.textContent = t('copied');
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    } catch {
      btn.textContent = 'Copy failed';
    }
  });
}
