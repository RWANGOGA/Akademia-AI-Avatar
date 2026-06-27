/**
 * LiveMeetingPanel.js — UI shell for the live meeting overlay.
 *
 * All meeting LOGIC lives in LiveMeetingSystem.js.
 * All meeting BACKEND lives in meeting.py.
 * This file ONLY wires DOM events and renders the UI.
 *
 * Language selection:
 *   "I speak"        → your microphone STT language
 *   "Translate to"   → ALL incoming content (speech + chat) is translated
 *                      to this language before display. Your own outgoing
 *                      chat is shown as-is on your side.
 *
 * WhatsApp-style transcript:
 *   - Your own messages → RIGHT side (sent bubble)
 *   - Other people     → LEFT side (received bubble) with speaker name
 *   - Original text on top, translation below in muted italic
 *   - Interim speech shown faded, replaced in-place when final arrives
 */

// ── Language options available in the lobby dropdowns ─────────────────────────
const SPEAK_OPTIONS = [
  { value: 'en',      label: '🇬🇧  English' },
  { value: 'ja',      label: '🇯🇵  Japanese' },
  { value: 'zh',      label: '🇨🇳  Mandarin Chinese' },
  { value: 'hi',      label: '🇮🇳  Hindi' },
  { value: 'luganda', label: '🇺🇬  Luganda (STT via English)' },
];

const HEAR_OPTIONS = [
  { value: 'en',      label: '🇬🇧  English' },
  { value: 'ja',      label: '🇯🇵  Japanese' },
  { value: 'zh',      label: '🇨🇳  Mandarin Chinese' },
  { value: 'hi',      label: '🇮🇳  Hindi' },
  { value: 'luganda', label: '🇺🇬  Luganda (text only)' },
];

export class LiveMeetingPanel {
  constructor(meetingSystem, callbacks = {}) {
    this.system  = meetingSystem;
    this.onClose = callbacks.onClose || (() => {});

    // DOM refs — populated in bind()
    this._overlay    = null;
    this._lobby      = null;
    this._room       = null;
    this._transcript = null;
    this._videoGrid  = null;
    this._statusEl   = null;
    this._roomCodeEl = null;
    this._countEl    = null;
    this._micBtn     = null;
    this._camBtn     = null;

    // Interim transcript map: speakerKey → DOM element
    this._interimMap = new Map();
  }

  // ── Called once by main.js on boot ────────────────────────────────────────
  bind() {
    this._overlay    = document.getElementById('meeting-overlay');
    this._lobby      = document.getElementById('meeting-lobby');
    this._room       = document.getElementById('meeting-room');
    this._transcript = document.getElementById('meeting-transcript');
    this._videoGrid  = document.getElementById('meeting-video-grid');
    this._statusEl   = document.getElementById('meeting-status');
    this._roomCodeEl = document.getElementById('meeting-room-code');
    this._countEl    = document.getElementById('meeting-participant-count');
    this._micBtn     = document.getElementById('meeting-mic-btn');
    this._camBtn     = document.getElementById('meeting-cam-btn');

    // Rebuild lobby dropdowns with full language list
    this._buildLobbyDropdowns();

    // Open overlay via top nav or menu
    document.getElementById('top-meeting-btn')
      ?.addEventListener('click', () => this._open());
    document.getElementById('menu-live-meeting')
      ?.addEventListener('click', () => this._open());

    // Close overlay
    document.getElementById('meeting-lobby-close')
      ?.addEventListener('click', () => this._close());

    // Create / Join
    document.getElementById('meeting-create-btn')
      ?.addEventListener('click', () => this._handleCreate());
    document.getElementById('meeting-join-btn')
      ?.addEventListener('click', () => this._handleJoin());

    // Leave
    document.getElementById('meeting-leave-btn')
      ?.addEventListener('click', () => this._handleLeave());

    // Mic toggle
    this._micBtn?.addEventListener('click', () => {
      const on = this.system.toggleMic();
      this._micBtn.classList.toggle('off', !on);
      this._micBtn.textContent = on ? '🎤' : '🔇';
    });

    // Camera toggle
    this._camBtn?.addEventListener('click', () => {
      const on = this.system.toggleCamera();
      this._camBtn.classList.toggle('off', !on);
      this._camBtn.textContent = '📷';
      this._camBtn.style.opacity = on ? '1' : '0.4';
    });

    // Avatar interpreter toggle
    document.getElementById('meeting-interpreter-toggle')
      ?.addEventListener('change', (e) => {
        this.system.setAvatarInterpreter(e.target.checked);
      });

    // Chat send
    document.getElementById('meeting-chat-send')
      ?.addEventListener('click', () => this._sendChat());
    document.getElementById('meeting-chat-input')
      ?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._sendChat();
        }
      });
  }

  // ── Rebuild lobby dropdowns with full language options ────────────────────
  _buildLobbyDropdowns() {
    const speakSel = document.getElementById('meeting-speak-lang');
    const hearSel  = document.getElementById('meeting-hear-lang');

    if (speakSel) {
      speakSel.innerHTML = '';
      SPEAK_OPTIONS.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        speakSel.appendChild(opt);
      });
      speakSel.value = 'en'; // default
    }

    if (hearSel) {
      hearSel.innerHTML = '';
      HEAR_OPTIONS.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        hearSel.appendChild(opt);
      });
      hearSel.value = 'ja'; // default

      // Update the label to make clear it covers chat + speech
      const hearLabel = hearSel.closest('.meeting-field')?.querySelector('label');
      if (hearLabel) {
        hearLabel.textContent = 'Translate everything to';
      }

      // Add a small hint below the hear dropdown
      if (!document.getElementById('hear-lang-hint')) {
        const hint = document.createElement('div');
        hint.id = 'hear-lang-hint';
        hint.style.cssText = `
          font-size: 0.64rem;
          color: rgba(255,255,255,0.42);
          margin-top: 4px;
          padding-left: 2px;
        `;
        hint.textContent = 'All incoming speech and chat messages will be translated to this language.';
        hearSel.parentElement?.appendChild(hint);
      }
    }
  }

  // ── Public API called by main.js ──────────────────────────────────────────
  showLobby() {
    this._lobby?.classList.remove('hidden');
    this._room?.classList.add('hidden');
    this.setStatus('Join or create a room');
    this._clearVideoGrid();
    this._clearTranscript();
  }

  /**
   * Called by main.js onTranscript — WhatsApp-style rendering.
   *
   * entry = {
   *   speaker, original, translated, lang, hearLang,
   *   self, interim, kind ('speech' | 'chat')
   * }
   *
   * Translation happens in LiveMeetingSystem.js before this is called.
   * This method only renders what it receives.
   */
  addTranscriptLine(entry) {
    if (!this._transcript) return;

    const isSelf     = entry.self;
    const isInterim  = entry.interim;
    const speaker    = entry.speaker    || 'Guest';
    const original   = entry.original   || '';
    const translated = entry.translated || '';
    const kind       = entry.kind       || 'speech';

    // ── Outer alignment wrapper ────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: ${isSelf ? 'flex-end' : 'flex-start'};
      padding: 0 4px;
      opacity: ${isInterim ? '0.52' : '1'};
      transition: opacity 0.25s ease;
    `;

    // ── Speaker label (other people only) ─────────────────────────────────
    if (!isSelf) {
      const nameEl = document.createElement('div');
      nameEl.style.cssText = `
        font-size: 0.61rem;
        font-weight: 700;
        color: rgba(255,255,255,0.48);
        margin-bottom: 3px;
        padding-left: 4px;
      `;
      nameEl.textContent = kind === 'chat' ? `💬 ${speaker}` : `🎤 ${speaker}`;
      wrap.appendChild(nameEl);
    }

    // ── Bubble ─────────────────────────────────────────────────────────────
    const bubble = document.createElement('div');
    bubble.style.cssText = `
      max-width: 80%;
      padding: 9px 14px;
      border-radius: ${isSelf
        ? '18px 18px 4px 18px'
        : '18px 18px 18px 4px'};
      background: ${isSelf
        ? 'rgba(255,255,255,0.14)'
        : 'rgba(28,28,30,0.95)'};
      border: 1px solid ${isSelf
        ? 'rgba(255,255,255,0.20)'
        : 'rgba(255,255,255,0.09)'};
      font-size: 0.79rem;
      line-height: 1.45;
      color: #fff;
      word-break: break-word;
    `;

    // Original text
    const origEl = document.createElement('div');
    origEl.textContent = original;
    bubble.appendChild(origEl);

    // ── Translation block ──────────────────────────────────────────────────
    // Show whenever translated text differs from original.
    // This covers both speech AND chat messages — LiveMeetingSystem
    // translates chat in _handleRemoteChat() before calling onTranscript.
    if (translated && translated !== original) {
      const divider = document.createElement('div');
      divider.style.cssText = `
        margin: 5px 0;
        border-top: 1px solid rgba(255,255,255,0.11);
      `;
      bubble.appendChild(divider);

      const transEl = document.createElement('div');
      transEl.style.cssText = `
        font-size: 0.72rem;
        color: rgba(255,255,255,0.62);
        font-style: italic;
        line-height: 1.4;
      `;
      transEl.textContent = translated;
      bubble.appendChild(transEl);
    }

    wrap.appendChild(bubble);

    // ── Timestamp (bottom corner) ──────────────────────────────────────────
    const time = document.createElement('div');
    time.style.cssText = `
      font-size: 0.58rem;
      color: rgba(255,255,255,0.28);
      margin-top: 2px;
      padding: ${isSelf ? '0 4px 0 0' : '0 0 0 4px'};
    `;
    time.textContent = new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    });
    wrap.appendChild(time);

    // ── Interim replacement logic ──────────────────────────────────────────
    // Interim lines replace themselves when the final result arrives,
    // so there are no duplicate partial-speech bubbles in the transcript.
    const interimKey = `${speaker}:${kind}`;

    if (isInterim) {
      const existing = this._interimMap.get(interimKey);
      if (existing?.parentNode) {
        existing.parentNode.replaceChild(wrap, existing);
      } else {
        this._transcript.appendChild(wrap);
      }
      this._interimMap.set(interimKey, wrap);
    } else {
      const existing = this._interimMap.get(interimKey);
      if (existing?.parentNode) {
        existing.parentNode.replaceChild(wrap, existing);
        this._interimMap.delete(interimKey);
      } else {
        this._transcript.appendChild(wrap);
      }
    }

    // Auto-scroll to latest message
    this._transcript.scrollTop = this._transcript.scrollHeight;
  }

  /** Called by main.js onParticipantChange */
  onParticipantChange() {
    this._rebuildVideoGrid();
    const count = this.system.participantCount;
    if (this._countEl) {
      this._countEl.textContent = `${count} connected`;
    }
  }

  setStatus(msg) {
    if (this._statusEl) this._statusEl.textContent = msg;
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  _open() {
    this._overlay?.classList.add('open');
    if (!this.system.isActive) this.showLobby();
  }

  _close() {
    this._overlay?.classList.remove('open');
    this.onClose();
  }

  async _handleCreate() {
    try {
      this.setStatus('Creating room…');
      const code = await this.system.createRoom();
      const input = document.getElementById('meeting-room-input');
      if (input) input.value = code;
      this.setStatus(`Room ${code} ready — click Join to enter`);
    } catch (e) {
      this.setStatus(`Error: ${e.message}`);
    }
  }

  async _handleJoin() {
    const name   = document.getElementById('meeting-name-input')?.value.trim() || 'Guest';
    const speak  = document.getElementById('meeting-speak-lang')?.value || 'en';
    const hear   = document.getElementById('meeting-hear-lang')?.value  || 'ja';
    const code   = document.getElementById('meeting-room-input')?.value.trim().toUpperCase();
    const interp = document.getElementById('meeting-interpreter-toggle')?.checked || false;

    if (!code) { this.setStatus('Enter a room code first'); return; }

    this.setStatus('Connecting…');
    try {
      await this.system.join(code, {
        name,
        speakLang: speak,
        hearLang:  hear,
        avatarInterpreter: interp,
      });
      this._lobby?.classList.add('hidden');
      this._room?.classList.remove('hidden');
      if (this._roomCodeEl) this._roomCodeEl.textContent = code;
      this.setStatus(`Room ${code} · connected`);
      this._clearTranscript();
      this._rebuildVideoGrid();
    } catch (e) {
      this.setStatus(`Failed: ${e.message}`);
    }
  }

  async _handleLeave() {
    await this.system.leave();
    this.showLobby();
  }

  _sendChat() {
    const input = document.getElementById('meeting-chat-input');
    const text  = input?.value.trim();
    if (!text) return;
    this.system.sendChat(text);
    if (input) input.value = '';
  }

  _clearTranscript() {
    if (this._transcript) this._transcript.innerHTML = '';
    this._interimMap.clear();
  }

  _clearVideoGrid() {
    if (this._videoGrid) this._videoGrid.innerHTML = '';
  }

  _rebuildVideoGrid() {
    if (!this._videoGrid) return;
    this._videoGrid.innerHTML = '';

    // Local tile
    const local = this.system.getLocalStream();
    if (local) {
      this._videoGrid.appendChild(
        this._makeTile('local', local, `${this.system.displayName} (you)`)
      );
    }

    // Remote tiles
    for (const { peerId, name, stream } of this.system.getRemoteStreams()) {
      if (stream) {
        this._videoGrid.appendChild(this._makeTile(peerId, stream, name));
      }
    }
  }

  _makeTile(id, stream, label) {
    const tile = document.createElement('div');
    tile.className  = 'meeting-video-tile';
    tile.dataset.id = id;

    const video       = document.createElement('video');
    video.autoplay    = true;
    video.playsInline = true;
    video.muted       = (id === 'local');
    video.srcObject   = stream;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';

    const lbl = document.createElement('div');
    lbl.className   = 'meeting-video-label';
    lbl.textContent = label;

    tile.appendChild(video);
    tile.appendChild(lbl);
    return tile;
  }
}