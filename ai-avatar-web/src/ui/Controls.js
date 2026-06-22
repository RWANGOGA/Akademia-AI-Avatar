/**
 * Controls — all DOM/UI wiring.
 *
 * Handles: chat input, mic, scrolling chat thread, avatar/scenario modal,
 * in-page preset avatar creator (no iframes), suggestions, profile card.
 */
const SUGGESTIONS = [
  'How do I say thank you in Japanese?',
  'Teach me a simple greeting.',
  'Translate: nice to meet you.',
  'Tell me about Tokyo.',
  'How are you today?',
  'What is the weather like in Japan?',
  'Explain Japanese counting numbers.',
  'How do I introduce myself in Japanese?',
];

export class Controls {
  constructor(handlers) {
    this.h = handlers;
    // { onAsk, onSelectAvatar, onSelectScenario, onCreateAvatar,
    //   onDeleteAvatar, onReset, getAvatars, currentAvatarId }
    this.recognizer = null;
    this.recording  = false;
    this.lang       = 'en-US';
    this._studioImage = null;   // data URL of a picture chosen in the creator
    this._voiceCatalog = { en: [], ja: [] };
  }

  init() {
    this._initVoice();
    this._bindInput();
    this._bindDropdown();
    this._bindModal();
    this._bindStudio();
    this._bindChatThread();
    this._bindVoiceSettings();
    this._initTabs();
    this._initScenarioCards();
    this.refreshSuggestions();
    // On phone-sized screens, start in the compact "peek" view (just the
    // latest message) to keep the avatar visible — matches the reference
    // mobile screenshot. Desktop starts fully expanded.
    if (window.innerWidth <= 600) this.collapseThread();
  }

  // ── Input ──────────────────────────────────────────────────────────────
  _bindInput() {
    const input = document.getElementById('user-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
      });
      // Auto-grow textarea
      input.addEventListener('input', () => {
        input.style.height = '34px';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      });
    }
    document.getElementById('send-btn')?.addEventListener('click', () => this._submit());
    document.getElementById('mic-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); this.toggleVoice();
    });
  }

  _submit() {
    const input = document.getElementById('user-input');
    const text  = (input?.value || '').trim();
    if (!text) return;
    if (input) { input.value = ''; input.style.height = '34px'; }
    this.addUserMessage(text);
    this.h.onAsk?.(text);
  }

  // ── Dropdown ───────────────────────────────────────────────────────────
  _bindDropdown() {
    const dropdown = document.getElementById('options-dropdown');
    document.getElementById('top-options-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); dropdown?.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown?.classList.remove('open'));
    document.getElementById('menu-restart-chat')?.addEventListener('click', () => {
      this.h.onReset?.();
      this.clearThread();
      this.showSpeechBubble('SYSTEM', 'Conversation memory cleared.', '');
    });
  }

  // ── Voice settings — change the CURRENT character's voice anytime ───────
  // Lives inside the ⋮ Options dropdown so it's always reachable without
  // covering the chat or input area at any screen size.
  _bindVoiceSettings() {
    document.getElementById('voice-select-en')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('voice-select-ja')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('voice-select-en')?.addEventListener('change', (e) => {
      this.h.onSetVoice?.('en', e.target.value);
    });
    document.getElementById('voice-select-ja')?.addEventListener('change', (e) => {
      this.h.onSetVoice?.('ja', e.target.value);
    });
  }

  /** Populate every voice <select> (the quick dropdown AND the Studio) from
   *  the backend's catalog: { en: [{name,label}], ja: [{name,label}] }. */
  setVoiceCatalog(catalog) {
    this._voiceCatalog = catalog || { en: [], ja: [] };
    const fill = (selectId) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      const lang = selectId.includes('-ja') ? 'ja' : 'en';
      select.innerHTML = (this._voiceCatalog[lang] || [])
        .map((v) => `<option value="${v.name}">${v.label}</option>`)
        .join('');
    };
    fill('voice-select-en');
    fill('voice-select-ja');
    fill('studio-avatar-voice-en');
    fill('studio-avatar-voice-ja');
  }

  /** Reflect the currently-selected avatar's voices in the quick dropdown. */
  setVoiceSelectors(voiceEn, voiceJa) {
    const en = document.getElementById('voice-select-en');
    const ja = document.getElementById('voice-select-ja');
    if (en && voiceEn) en.value = voiceEn;
    if (ja && voiceJa) ja.value = voiceJa;
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  _bindModal() {
    const modal = document.getElementById('avatar-modal');
    document.getElementById('avatar-swap-btn')?.addEventListener('click', () =>
      this.openSelectionWindow('scenarios'));
    document.getElementById('avatar-modal-close')?.addEventListener('click', () =>
      modal?.classList.remove('open'));
    // Close on overlay click (outside .modal)
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  // ── Studio ─────────────────────────────────────────────────────────────
  _bindStudio() {
    document.getElementById('launch-studio-btn')?.addEventListener('click', () => this.openStudio());
    document.getElementById('close-studio-btn')?.addEventListener('click',  () => this.closeStudio());
    document.getElementById('save-studio-avatar-btn')?.addEventListener('click', () => this.saveStudioAvatar());
    // Optional picture upload — reads the chosen file into a preview + data URL.
    document.getElementById('studio-avatar-image')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const preview = document.getElementById('studio-image-preview');
      if (!file) { this._studioImage = null; if (preview) preview.style.backgroundImage = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        this._studioImage = reader.result;
        if (preview) preview.style.backgroundImage = `url("${reader.result}")`;
      };
      reader.readAsDataURL(file);
    });
    // Live labels for the appearance sliders.
    const bindSliderLabel = (sliderId, labelId, fmt) => {
      const slider = document.getElementById(sliderId);
      const label  = document.getElementById(labelId);
      slider?.addEventListener('input', () => {
        if (label) label.textContent = fmt(parseFloat(slider.value));
      });
    };
    bindSliderLabel('studio-avatar-height', 'studio-avatar-height-label', (v) => Math.round(v * 100) + '%');
    bindSliderLabel('studio-avatar-build',  'studio-avatar-build-label',  (v) => Math.round(v * 100) + '%');
    // The second cancel button and style-tile logic are in index.html inline
    // script (needed before the module loads). Nothing extra needed here.
  }

  openStudio() {
    document.getElementById('avatar-modal')?.classList.remove('open');
    // Reset text fields
    ['studio-avatar-name', 'studio-avatar-bio', 'studio-avatar-image'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    this._studioImage = null;
    const preview = document.getElementById('studio-image-preview');
    if (preview) preview.style.backgroundImage = '';
    // Reset style tiles to first option
    const tiles  = document.querySelectorAll('.style-tile');
    const hidden = document.getElementById('studio-avatar-style');
    tiles.forEach((t, i) => {
      t.classList.toggle('chosen', i === 0);
      const radio = t.querySelector('input[type="radio"]');
      if (radio) radio.checked = i === 0;
    });
    if (hidden) hidden.value = 'anime-female';
    // Reset appearance customization fields
    const hair = document.getElementById('studio-avatar-hair');
    if (hair) hair.value = '#3b2a23';
    const cloth = document.getElementById('studio-avatar-cloth');
    if (cloth) cloth.value = '#6d5a8a';
    const skin = document.getElementById('studio-avatar-skin');
    if (skin) skin.value = '#caa07a';
    const height = document.getElementById('studio-avatar-height');
    if (height) height.value = '1';
    const heightLabel = document.getElementById('studio-avatar-height-label');
    if (heightLabel) heightLabel.textContent = '100%';
    const build = document.getElementById('studio-avatar-build');
    if (build) build.value = '1';
    const buildLabel = document.getElementById('studio-avatar-build-label');
    if (buildLabel) buildLabel.textContent = '100%';
    const voiceEnSel = document.getElementById('studio-avatar-voice-en');
    if (voiceEnSel) voiceEnSel.selectedIndex = 0;
    const voiceJaSel = document.getElementById('studio-avatar-voice-ja');
    if (voiceJaSel) voiceJaSel.selectedIndex = 0;

    document.getElementById('studio-overlay')?.classList.add('open');
  }

  closeStudio() {
    document.getElementById('studio-overlay')?.classList.remove('open');
  }

  saveStudioAvatar() {
    const val     = (id) => (document.getElementById(id)?.value || '').trim();
    const name    = val('studio-avatar-name') || 'Custom Avatar';
    const style   = document.getElementById('studio-avatar-style')?.value || 'anime-female';
    const culture = document.getElementById('studio-avatar-lang')?.value  || 'en';
    const bio     = val('studio-avatar-bio') || 'Custom avatar.';

    const hairColor   = document.getElementById('studio-avatar-hair')?.value  || null;
    const clothColor  = document.getElementById('studio-avatar-cloth')?.value || null;
    const skinColor   = document.getElementById('studio-avatar-skin')?.value  || null;
    const heightRaw   = document.getElementById('studio-avatar-height')?.value;
    const buildRaw    = document.getElementById('studio-avatar-build')?.value;
    const heightScale = heightRaw ? parseFloat(heightRaw) : 1;
    const buildScale  = buildRaw ? parseFloat(buildRaw) : 1;
    const voiceEn     = document.getElementById('studio-avatar-voice-en')?.value || null;
    const voiceJa     = document.getElementById('studio-avatar-voice-ja')?.value || null;

    if (!val('studio-avatar-name')) {
      document.getElementById('studio-avatar-name')?.focus();
      return;
    }
    this.h.onCreateAvatar?.({
      name, style, culture, bio, image: this._studioImage,
      hairColor, clothColor, skinColor, heightScale, buildScale, voiceEn, voiceJa,
    });
    this.closeStudio();
  }

  // ── Voice input ────────────────────────────────────────────────────────
  _initVoice() {
    const Engine = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Engine) { console.warn('Speech recognition not supported.'); return; }
    this.recognizer = new Engine();
    this.recognizer.continuous      = false;
    this.recognizer.interimResults  = false;
    this.recognizer.maxAlternatives = 3;

    this.recognizer.onstart = () => {
      this.recording = true;
      const btn = document.getElementById('mic-btn');
      if (btn) { btn.classList.add('recording'); btn.textContent = '⏹'; }
      this.setStatus('Listening…');
    };
    this.recognizer.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (text) {
        this.addUserMessage(text);
        this.h.onAsk?.(text);
      }
    };
    this.recognizer.onerror = (e) => {
      if (e.error === 'not-allowed') {
        this.showSpeechBubble('SYSTEM', 'Microphone blocked. Click the site info icon (left of the address bar) and allow Microphone — if you\'re on Brave, also turn Shields off for this site (the lion icon), since Shields can silently block mic access.', '');
      } else if (e.error === 'no-speech') {
        this.setStatus('No speech detected');
      } else if (e.error === 'audio-capture') {
        this.showSpeechBubble('SYSTEM', 'No microphone found. Please connect one.', '');
      } else {
        this.showSpeechBubble('SYSTEM', `Mic error: ${e.error}`, '');
      }
      this._stopVoiceUI();
    };
    this.recognizer.onend = () => this._stopVoiceUI();
  }

  setVoiceLang(culture) { this.lang = culture === 'ja' ? 'ja-JP' : 'en-US'; }

  async toggleVoice() {
    if (!this.recognizer) {
      this.showSpeechBubble('SYSTEM', 'Voice input needs Chrome, Edge, or Brave (Shields off) on localhost or HTTPS.', '');
      return;
    }
    if (this.recording) { this.recognizer.stop(); return; }

    // Prime/verify the actual OS+browser mic permission first. This makes
    // the failure mode explicit (and catchable) instead of the recognizer
    // just silently erroring — important for browsers like Brave where
    // Shields can block getUserMedia even though the page loads fine.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      this.showSpeechBubble('SYSTEM', `Microphone permission was blocked (${err.name}). Check the address bar's site permissions, and if you're on Brave, turn Shields off for this site.`, '');
      return;
    }

    this.recognizer.lang = this.lang;
    try {
      this.recognizer.start();
    } catch (err) {
      console.error(err);
      this.showSpeechBubble('SYSTEM', `Could not start the microphone: ${err.message}`, '');
    }
  }

  _stopVoiceUI() {
    this.recording = false;
    const btn = document.getElementById('mic-btn');
    if (btn) { btn.classList.remove('recording'); btn.textContent = '🎤'; }
    this.setStatus('Ready');
  }

  // ── Status ─────────────────────────────────────────────────────────────
  setStatus(msg) { const el = document.getElementById('status-text'); if (el) el.textContent = msg; }
  setDot(c)      { const el = document.getElementById('status-dot');  if (el) el.className = `dot ${c}`; }
  setBusy(b)     { const btn = document.getElementById('send-btn');   if (btn) btn.disabled = b; }

  // ── Chat thread — collapsible scrolling conversation ────────────────────
  // Default: full scrollable history. Tapping anywhere on the scene/avatar
  // (i.e. outside the chat panel and outside the floating toggle) collapses
  // it down to just the latest message so the avatar isn't blocked.
  // Tapping or scrolling back inside the panel — or the floating ⌄ button —
  // brings the full thread back. This one set of listeners covers every
  // screen size, since it's the same #chat-thread element throughout.
  _bindChatThread() {
    document.getElementById('chat-clear')?.addEventListener('click', () => {
      this.h.onReset?.();
      this.clearThread();
      this.showSpeechBubble('SYSTEM', 'Conversation cleared.', '');
    });
    document.getElementById('chat-replay')?.addEventListener('click', () => {
      this.h.onReplay?.();
    });

    const thread = document.getElementById('chat-thread');
    const expand = () => this.expandThread();
    thread?.addEventListener('click', expand);
    thread?.addEventListener('wheel', expand, { passive: true });
    thread?.addEventListener('touchstart', expand, { passive: true });

    // Tapping the avatar/scene itself collapses the conversation. This is a
    // deliberate, narrow match (not "anywhere outside the chat") so that
    // clicking nav buttons, suggestions, or Send doesn't unexpectedly
    // collapse the thread right when you want to see the reply.
    document.querySelector('.viewport-canvas-container')?.addEventListener('click', () => {
      this.collapseThread();
    });
  }

  /** Only jumps to the bottom on the ACTUAL collapsed→expanded transition.
   *  The previous version jumped to the bottom on every call, which fired
   *  on every wheel/touch tick inside the thread — meaning the moment you
   *  expanded it, any attempt to scroll up snapped straight back to the
   *  bottom on the very next scroll event. That was the "can't scroll
   *  through history" bug. Once already expanded, calling this again is a
   *  no-op, so normal scrolling works exactly as you'd expect. */
  expandThread() {
    const thread = document.getElementById('chat-thread');
    if (!thread) return;
    const wasCollapsed = thread.classList.contains('collapsed');
    thread.classList.remove('collapsed');
    if (wasCollapsed) this._scrollThreadToBottom();
  }

  collapseThread() {
    const thread = document.getElementById('chat-thread');
    if (!thread) return;
    thread.classList.add('collapsed');
    this._scrollThreadToBottom(); // ensure the LATEST message is what's visible
  }

  _scrollThreadToBottom() {
    const thread = document.getElementById('chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  clearThread() {
    const thread = document.getElementById('chat-thread');
    if (thread) thread.innerHTML = '';
  }

  /** The person's own message — small pill, right-aligned. */
  addUserMessage(text) {
    const thread = document.getElementById('chat-thread');
    if (!thread) return;
    const row = document.createElement('div');
    row.className = 'msg msg-user';
    row.innerHTML = `<div class="msg-bubble msg-bubble-user"></div>`;
    row.querySelector('.msg-bubble').textContent = text;
    thread.appendChild(row);
    this._scrollThreadToBottom();
  }

  /** Avatar / system message — kept as `showSpeechBubble` so existing call
   *  sites (main.js, mic errors, studio notices) don't need to change.
   *  AVATAR messages render as a full bubble with EN + JA; everything else
   *  (SYSTEM / STUDIO) renders as a small centered notice in the thread. */
  showSpeechBubble(lang, en, ja) {
    const thread = document.getElementById('chat-thread');
    if (!thread) return;
    const row = document.createElement('div');

    if (lang === 'AVATAR') {
      row.className = 'msg msg-avatar';
      row.innerHTML = `
        <div class="msg-bubble msg-bubble-avatar">
          <div class="speech-lang">${lang}</div>
          <div class="speech-en"></div>
          <div class="speech-ja" style="display:none"></div>
        </div>`;
      row.querySelector('.speech-en').textContent = en || '';
      const jaEl = row.querySelector('.speech-ja');
      if (ja) { jaEl.textContent = ja; jaEl.style.display = 'block'; }
    } else {
      row.className = 'msg msg-system';
      row.innerHTML = `<div class="msg-bubble msg-bubble-system"></div>`;
      row.querySelector('.msg-bubble').textContent = `${lang}: ${en || ''}`;
    }

    thread.appendChild(row);
    this._scrollThreadToBottom();
  }

  refreshSuggestions() {
    const container = document.getElementById('suggestions');
    if (!container) return;
    container.innerHTML = '';
    [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 2).forEach((p) => {
      const btn = document.createElement('button');
      btn.className   = 'suggest-btn';
      btn.textContent = p;
      btn.addEventListener('click', () => {
        this.addUserMessage(p);
        this.h.onAsk?.(p);
      });
      container.appendChild(btn);
    });
  }

  // ── Profile card ───────────────────────────────────────────────────────
  setProfile({ name, handle, bio }) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('avatar-name',   name);
    set('avatar-handle', handle);
    set('avatar-bio',    bio);
  }

  // ── Selection modal ────────────────────────────────────────────────────
  openSelectionWindow(tab) {
    this.buildAvatarStack();
    document.getElementById('avatar-modal')?.classList.add('open');
    this._switchTab(tab);
  }

  // Builds a thumbnail that shows a picture when one is available and
  // gracefully falls back to a colored gradient if the image is missing.
  _thumbHtml(imageUrl, gradient) {
    const img = imageUrl
      ? `<img class="pick-thumb-img" src="${imageUrl}" alt="" loading="lazy"
             onload="this.classList.add('loaded')" onerror="this.remove()" />`
      : '';
    return `<div class="pick-thumb" style="background:${gradient}">${img}</div>`;
  }

  buildAvatarStack() {
    const grid = document.getElementById('avatar-picker-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const avatars   = this.h.getAvatars?.() || [];
    const currentId = this.h.currentAvatarId?.();
    const palette   = ['#3a3a3d', '#33333a', '#3d3a36', '#363a3d', '#3a3636', '#36383a'];

    avatars.forEach((a, i) => {
      const card     = document.createElement('div');
      card.className = `pick-card${a.id === currentId ? ' active' : ''}`;
      const tint     = a.hairColor || palette[i % palette.length];
      const isCustom = a.id.startsWith('custom-');
      const gradient = `radial-gradient(circle at 30% 30%,${tint},#0b0b14)`;

      card.innerHTML = `
        ${this._thumbHtml(a.image, gradient)}
        <div class="pick-card-body">
          <div class="pick-card-title">${a.name}${isCustom ? ' <span style="font-size:0.58em;opacity:0.55">(Custom)</span>' : ''}</div>
          <div class="pick-card-desc">${a.bio}</div>
          <div style="display:flex;gap:7px;margin-top:8px;flex-wrap:wrap">
            <button class="enter-scene-btn">Enter Scene</button>
            ${isCustom ? `<button class="delete-btn" style="padding:6px 12px;border-radius:999px;border:none;background:#ef4444;color:#fff;font-size:0.7rem;font-weight:700;cursor:pointer">Delete</button>` : ''}
          </div>
        </div>`;

      const choose = () => {
        grid.querySelectorAll('.pick-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.h.onSelectAvatar?.(a.id);
        document.getElementById('avatar-modal')?.classList.remove('open');
      };

      card.addEventListener('click', choose);
      card.querySelector('.enter-scene-btn')?.addEventListener('click', (e) => {
        e.stopPropagation(); choose();
      });

      if (isCustom) {
        card.querySelector('.delete-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete avatar "${a.name}"?`)) {
            this.h.onDeleteAvatar?.(a.id);
            this.buildAvatarStack();
          }
        });
      }
      grid.appendChild(card);
    });
  }

  _initTabs() {
    document.getElementById('tab-trigger-scenarios')?.addEventListener('click', () => this._switchTab('scenarios'));
    document.getElementById('tab-trigger-characters')?.addEventListener('click', () => this._switchTab('characters'));
  }

  _switchTab(tab) {
    const scen = tab === 'scenarios';
    document.getElementById('tab-trigger-scenarios')?.classList.toggle('active',  scen);
    document.getElementById('tab-trigger-characters')?.classList.toggle('active', !scen);
    document.getElementById('tab-content-scenarios')?.classList.toggle('active',  scen);
    document.getElementById('tab-content-characters')?.classList.toggle('active', !scen);
    const title = document.getElementById('modal-title');
    if (title) title.textContent = scen ? 'Discover New Scenarios' : 'Discover New Characters';
    const subtitle = document.getElementById('modal-subtitle');
    if (subtitle) {
      subtitle.textContent = scen
        ? "Pick a scenario to change the mood, background and how your character responds — your character stays whoever you've chosen in the Character tab."
        : 'Pick a character to change who you\'re talking to and what they look like — your scenario (mood/background) stays the same until you change it in the Scenario tab.';
    }
    // "Create Avatar" belongs to Characters only — hide it on the Scenario tab.
    const studioBtn = document.getElementById('launch-studio-btn');
    if (studioBtn) studioBtn.style.display = scen ? 'none' : '';
    if (!scen) this.buildAvatarStack();   // refresh whenever Characters tab opens
  }

  _initScenarioCards() {
    document.querySelectorAll('#scenario-picker-grid .pick-card').forEach((card) => {
      const choose = () => {
        document.querySelectorAll('#scenario-picker-grid .pick-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.h.onSelectScenario?.(card.getAttribute('data-scenario'));
        document.getElementById('avatar-modal')?.classList.remove('open');
      };
      card.addEventListener('click', choose);
      card.querySelector('.enter-scene-btn')?.addEventListener('click', (e) => {
        e.stopPropagation(); choose();
      });
    });
  }
}