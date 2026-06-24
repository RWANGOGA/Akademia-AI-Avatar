/**
 * LiveMeetingPanel — full-screen meeting UI with video grid, live transcript,
 * language settings, and avatar interpreter toggle.
 */
export class LiveMeetingPanel {
  constructor(meetingSystem, callbacks = {}) {
    this.meeting = meetingSystem;
    this.onClose = callbacks.onClose || (() => {});
    this.overlay = document.getElementById('meeting-overlay');
    this._videoEls = new Map();
    this._bound = false;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;

    document.getElementById('menu-live-meeting')?.addEventListener('click', () => {
      document.getElementById('options-dropdown')?.classList.remove('open');
      this.openLobby();
    });
    document.getElementById('top-meeting-btn')?.addEventListener('click', () => this.openLobby());

    document.getElementById('meeting-lobby-close')?.addEventListener('click', () => this.close());
    document.getElementById('meeting-create-btn')?.addEventListener('click', () => this._createRoom());
    document.getElementById('meeting-join-btn')?.addEventListener('click', () => this._joinRoom());
    document.getElementById('meeting-leave-btn')?.addEventListener('click', () => this._leave());
    document.getElementById('meeting-mic-btn')?.addEventListener('click', () => this._toggleMic());
    document.getElementById('meeting-cam-btn')?.addEventListener('click', () => this._toggleCam());
    document.getElementById('meeting-interpreter-toggle')?.addEventListener('change', (e) => {
      this.meeting.setAvatarInterpreter(e.target.checked);
    });
    document.getElementById('meeting-chat-send')?.addEventListener('click', () => this._sendChat());
    document.getElementById('meeting-chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._sendChat(); }
    });
  }

  openLobby() {
    if (!this.overlay) return;
    this.overlay.classList.add('open');
    document.getElementById('meeting-lobby')?.classList.remove('hidden');
    document.getElementById('meeting-room')?.classList.add('hidden');
  }

  close() {
    if (this.meeting.isActive) {
      this._leave();
      return;
    }
    if (this.overlay) this.overlay.classList.remove('open');
    this.onClose();
  }

  showRoom(roomId) {
    document.getElementById('meeting-lobby')?.classList.add('hidden');
    document.getElementById('meeting-room')?.classList.remove('hidden');
    const codeEl = document.getElementById('meeting-room-code');
    if (codeEl) codeEl.textContent = roomId;
    this._refreshVideos();
  }

  showLobby() {
    document.getElementById('meeting-lobby')?.classList.remove('hidden');
    document.getElementById('meeting-room')?.classList.add('hidden');
  }

  addTranscriptLine(entry) {
    const list = document.getElementById('meeting-transcript');
    if (!list) return;

    if (entry.interim) {
      const existing = list.querySelector('[data-interim="self"]');
      if (existing) existing.remove();
      const row = this._transcriptRow(entry, true);
      row.dataset.interim = entry.self ? 'self' : 'remote';
      list.appendChild(row);
    } else {
      const interim = list.querySelector(`[data-interim="${entry.self ? 'self' : 'remote'}"]`);
      if (interim) interim.remove();
      list.appendChild(this._transcriptRow(entry, false));
    }

    list.scrollTop = list.scrollHeight;
  }

  setStatus(text) {
    const el = document.getElementById('meeting-status');
    if (el) el.textContent = text;
  }

  setParticipantCount(n) {
    const el = document.getElementById('meeting-participant-count');
    if (el) el.textContent = `${n} connected`;
  }

  _transcriptRow(entry, interim) {
    const row = document.createElement('div');
    row.className = `meeting-transcript-line${interim ? ' interim' : ''}`;
    const showBoth = entry.original !== entry.translated;
    const prefix = entry.kind === 'chat' ? '💬' : '🎙';
    row.innerHTML = `
      <div class="meeting-transcript-speaker">${prefix} ${entry.speaker}</div>
      <div class="meeting-transcript-original">${entry.original}</div>
      ${showBoth ? `<div class="meeting-transcript-translated">→ ${entry.translated}</div>` : ''}
    `;
    return row;
  }

  async _createRoom() {
    this.setStatus('Creating room…');
    try {
      const code = await this.meeting.createRoom();
      const input = document.getElementById('meeting-room-input');
      if (input) input.value = code;
      this.setStatus(`Room ${code} created — share this code`);
    } catch (e) {
      this.setStatus(`Error: ${e.message}`);
    }
  }

  async _joinRoom() {
    const roomId = document.getElementById('meeting-room-input')?.value?.trim();
    const name = document.getElementById('meeting-name-input')?.value?.trim() || 'Guest';
    const speakLang = document.getElementById('meeting-speak-lang')?.value || 'en';
    const hearLang = document.getElementById('meeting-hear-lang')?.value || 'ja';
    const avatarInterpreter = document.getElementById('meeting-interpreter-toggle')?.checked;

    this.setStatus('Joining…');
    try {
      await this.meeting.join(roomId, {
        name, speakLang, hearLang, avatarInterpreter,
      });
      this.showRoom(this.meeting.roomId);
      this.setStatus('Connected');
      this.setParticipantCount(this.meeting.participantCount);
    } catch (e) {
      this.setStatus(`Could not join: ${e.message}`);
    }
  }

  async _leave() {
    await this.meeting.leave();
    this._clearVideos();
    document.getElementById('meeting-transcript')?.replaceChildren();
    if (this.overlay) this.overlay.classList.remove('open');
    this.showLobby();
    this.setStatus('Left meeting');
    this.onClose();
  }

  _toggleMic() {
    const on = this.meeting.toggleMic();
    const btn = document.getElementById('meeting-mic-btn');
    if (btn) {
      btn.textContent = on ? '🎤' : '🔇';
      btn.classList.toggle('off', !on);
    }
  }

  _toggleCam() {
    const on = this.meeting.toggleCamera();
    const btn = document.getElementById('meeting-cam-btn');
    if (btn) {
      btn.textContent = on ? '📷' : '🚫';
      btn.classList.toggle('off', !on);
    }
    this._refreshVideos();
  }

  _sendChat() {
    const input = document.getElementById('meeting-chat-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    this.meeting.sendChat(text);
    if (input) input.value = '';
  }

  _refreshVideos() {
    const grid = document.getElementById('meeting-video-grid');
    if (!grid) return;

    const tiles = [];

    const local = this.meeting.getLocalStream();
    if (local) {
      tiles.push({
        id: 'local',
        name: this.meeting.displayName + ' (you)',
        stream: local,
      });
    }

    this.meeting.getRemoteStreams().forEach((r) => {
      tiles.push({ id: r.peerId, name: r.name, stream: r.stream });
    });

    // Remove stale
    for (const [id, el] of this._videoEls) {
      if (!tiles.find((t) => t.id === id)) {
        el.remove();
        this._videoEls.delete(id);
      }
    }

    tiles.forEach((t) => {
      let tile = this._videoEls.get(t.id);
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'meeting-video-tile';
        tile.innerHTML = `
          <video autoplay playsinline muted></video>
          <div class="meeting-video-label"></div>
        `;
        grid.appendChild(tile);
        this._videoEls.set(t.id, tile);
      }
      const video = tile.querySelector('video');
      const label = tile.querySelector('.meeting-video-label');
      if (label) label.textContent = t.name;
      if (video && t.stream) {
        video.srcObject = t.stream;
        video.muted = t.id === 'local';
      }
    });

    this.setParticipantCount(this.meeting.participantCount);
  }

  _clearVideos() {
    const grid = document.getElementById('meeting-video-grid');
    if (grid) grid.innerHTML = '';
    this._videoEls.clear();
  }

  onParticipantChange() {
    this._refreshVideos();
  }
}
