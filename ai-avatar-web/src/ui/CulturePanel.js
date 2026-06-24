/**
 * CulturePanel — Do/Don't, comparisons, Luganda phrases UI.
 */
import { DO_DONT } from '../culture/doDontCards.js';
import { COMPARISONS } from '../culture/comparisonCards.js';
import { LUGANDA_PHRASES } from '../culture/lugandaPhrases.js';

export class CulturePanel {
  constructor(handlers = {}) {
    this.h = handlers; // { onPracticePhrase, onAsk }
    this.overlay = document.getElementById('culture-panel-overlay');
    this.body = document.getElementById('culture-panel-body');
    this.title = document.getElementById('culture-panel-title');
    this._bindClose();
  }

  _bindClose() {
    document.getElementById('culture-panel-close')?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  open(view = 'guide') {
    if (!this.overlay || !this.body) return;
    this.overlay.classList.add('open');
    if (view === 'compare') this._renderCompare();
    else if (view === 'luganda') this._renderLuganda();
    else this._renderGuide();
  }

  close() {
    this.overlay?.classList.remove('open');
  }

  _renderGuide() {
    if (this.title) this.title.textContent = 'Culture Guide';
    const u = DO_DONT.uganda;
    const j = DO_DONT.japan;
    this.body.innerHTML = `
      <div class="culture-section">
        <h3>${u.flag} ${u.title}</h3>
        <div class="culture-columns">
          <div><strong>Do</strong><ul>${u.dos.map((d) => `<li>${d}</li>`).join('')}</ul></div>
          <div><strong>Don't</strong><ul>${u.donts.map((d) => `<li>${d}</li>`).join('')}</ul></div>
        </div>
      </div>
      <div class="culture-section">
        <h3>${j.flag} ${j.title}</h3>
        <div class="culture-columns">
          <div><strong>Do</strong><ul>${j.dos.map((d) => `<li>${d}</li>`).join('')}</ul></div>
          <div><strong>Don't</strong><ul>${j.donts.map((d) => `<li>${d}</li>`).join('')}</ul></div>
        </div>
      </div>
      <div class="culture-nav-row">
        <button type="button" class="culture-nav-btn" data-view="compare">Compare Cultures</button>
        <button type="button" class="culture-nav-btn" data-view="luganda">Luganda Phrases</button>
      </div>`;
    this._bindNav();
  }

  _renderCompare() {
    if (this.title) this.title.textContent = 'Compare Cultures';
    this.body.innerHTML = COMPARISONS.map((c) => `
      <div class="culture-section culture-compare-block">
        <h3>${c.topic}</h3>
        <table class="culture-table">
          <thead><tr><th>Japan</th><th>Uganda</th></tr></thead>
          <tbody>
            ${c.rows.map((r) => `<tr><td>${r.japan}</td><td>${r.uganda}</td></tr>`).join('')}
          </tbody>
        </table>
        <button type="button" class="culture-ask-btn" data-ask="Explain the cultural difference for ${c.topic} between Japan and Uganda for a business meeting.">
          Ask avatar about this
        </button>
      </div>`).join('') +
      `<div class="culture-nav-row"><button type="button" class="culture-nav-btn" data-view="guide">← Back to Guide</button></div>`;
    this._bindNav();
    this._bindAsk();
  }

  _renderLuganda() {
    if (this.title) this.title.textContent = 'Luganda Phrases';
    this.body.innerHTML = `
      <p class="culture-intro">A few Luganda phrases go a long way with Ugandan partners.</p>
      ${LUGANDA_PHRASES.map((p) => `
        <div class="culture-phrase-card">
          <div class="culture-phrase-lg">${p.luganda}</div>
          <div class="culture-phrase-mean">${p.meaning}</div>
          <div class="culture-phrase-ja">${p.japanese}</div>
          <div class="culture-phrase-when">When: ${p.when}</div>
          <button type="button" class="culture-ask-btn" data-phrase="${p.luganda}" data-ask="Teach me how to say '${p.luganda}' (${p.meaning}) — pronunciation, when to use it, and cultural context.">
            Practice with avatar
          </button>
        </div>`).join('')}
      <div class="culture-nav-row"><button type="button" class="culture-nav-btn" data-view="guide">← Back to Guide</button></div>`;
    this._bindNav();
    this._bindAsk(true);
  }

  _bindNav() {
    this.body?.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-view');
        if (v === 'compare') this._renderCompare();
        else if (v === 'luganda') this._renderLuganda();
        else this._renderGuide();
      });
    });
  }

  _bindAsk(trackPhrase = false) {
    this.body?.querySelectorAll('[data-ask]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-ask');
        const phrase = btn.getAttribute('data-phrase');
        this.close();
        if (phrase) this.h.onPracticePhrase?.(phrase);
        if (q) this.h.onAsk?.(q);
      });
    });
  }
}
