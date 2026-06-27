/**
 * LiveMeetingSystem — WebRTC mesh calls with real-time avatar interpretation.
 *
 * Avatar Interpreter Flow:
 *  1. Person A speaks → Web Speech API captures speech
 *  2. Interim results shown locally only (never broadcast) — no duplicates
 *  3. Final result broadcast to all peers via WebSocket
 *  4. Each peer translates into their hearLang
 *  5. If avatarInterpreter ON → avatar speaks translated text with lip sync
 *
 * Languages supported: en, ja, zh (Mandarin), hi (Hindi), luganda
 * Files changed: ONLY this file + meeting.py
 */

// ── Language maps ─────────────────────────────────────────────────────────────
const SPEAK_LANG_MAP = {
  en:      'en-US',
  ja:      'ja-JP',
  zh:      'zh-CN',
  hi:      'hi-IN',
  luganda: 'en-US',
};

const VOICE_MAP = {
  en:      'en-US-JennyNeural',
  ja:      'ja-JP-NanamiNeural',
  zh:      'zh-CN-XiaoxiaoNeural',
  hi:      'hi-IN-SwaraNeural',
  luganda: 'en-US-JennyNeural',
};

// ── Translate helper ──────────────────────────────────────────────────────────
async function _callTranslate(backendUrl, text, targetLang) {
  if (!text || !text.trim()) return text;

  if (targetLang === 'ja' || targetLang === 'en') {
    const form = new FormData();
    form.append('text', text);
    form.append('target', targetLang);
    try {
      const res = await fetch(`${backendUrl}/translate`, { method: 'POST', body: form });
      if (!res.ok) return text;
      const data = await res.json();
      return data.text || text;
    } catch (_) { return text; }
  }

  if (targetLang === 'zh' || targetLang === 'hi') {
    const langLabel = targetLang === 'zh' ? 'Mandarin Chinese (Simplified)' : 'Hindi';
    try {
      const res = await fetch(`${backendUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Translate ONLY this text to ${langLabel}. Output ONLY the translation, no explanation: "${text}"`,
          persona: 'FirstMeeting',
          culture_mode: 'uganda',
        }),
      });
      if (!res.ok) return text;
      const data = await res.json();
      return data.reply || text;
    } catch (_) { return text; }
  }

  if (targetLang === 'luganda') {
    const form = new FormData();
    form.append('text', text);
    form.append('target', 'en');
    try {
      const res = await fetch(`${backendUrl}/translate`, { method: 'POST', body: form });
      if (!res.ok) return text;
      const data = await res.json();
      return data.text || text;
    } catch (_) { return text; }
  }

  return text;
}

// ── Voice/TTS helper ──────────────────────────────────────────────────────────
async function _callVoice(backendUrl, text, lang) {
  if (!text || !text.trim()) return null;
  const voice = VOICE_MAP[lang] || VOICE_MAP['en'];
  const form = new FormData();
  form.append('text', text);
  form.append('voice', voice);
  form.append('culture', lang);
  try {
    const res = await fetch(`${backendUrl}/voice`, { method: 'POST', body: form });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
export class LiveMeetingSystem {
  constructor(brain, callbacks = {}) {
    this.brain = brain;
    this.onStateChange        = callbacks.onStateChange        || (() => {});
    this.onTranscript         = callbacks.onTranscript         || (() => {});
    this.onParticipantChange  = callbacks.onParticipantChange  || (() => {});
    this.onInterpreterSpeech  = callbacks.onInterpreterSpeech  || (() => {});
    this.onError              = callbacks.onError              || (() => {});

    this.roomId            = null;
    this.peerId            = null;
    this.displayName       = 'Guest';
    this.speakLang         = 'en';
    this.hearLang          = 'ja';
    this.avatarInterpreter = false;
    this.cameraEnabled     = true;
    this.micEnabled        = true;

    this.ws          = null;
    this.localStream = null;
    this.peers       = new Map();
    this.recognizer  = null;
    this._wantSpeech = false;
    this._active     = false;

    // Speech queue for avatar interpreter
    this._speechQueue = [];
    this._isPlaying   = false;

    // Interim display key — tracks the current interim bubble per speaker
    // so we can replace it in place without broadcasting to server
    this._localInterimKey = 'self:speech';
  }

  // ── Public getters ─────────────────────────────────────────────────────────
  get isActive()         { return this._active; }
  get participantCount() { return this.peers.size + (this.localStream ? 1 : 0); }

  // ── Room management ────────────────────────────────────────────────────────
  async createRoom() {
    const res = await fetch(`${this.brain.backend}/meeting/create`);
    if (!res.ok) throw new Error('Could not create meeting room');
    const data = await res.json();
    return data.room_id;
  }

  async join(roomId, { name, speakLang, hearLang, avatarInterpreter }) {
    if (this._active) await this.leave();

    this.roomId        = (roomId || '').trim().toUpperCase();
    if (!this.roomId)  throw new Error('Enter a room code');

    this.displayName       = (name || 'Guest').trim().slice(0, 40) || 'Guest';
    this.speakLang         = speakLang || 'en';
    this.hearLang          = hearLang  || 'ja';
    this.avatarInterpreter = Boolean(avatarInterpreter);

    await this._startLocalMedia();
    await this._connectSignaling();
    this._initSpeechRecognition();
    this._wantSpeech = true;
    this._startSpeech();
    this._active = true;
    this.onStateChange('connected');
  }

  async leave() {
    this._wantSpeech  = false;
    this._speechQueue = [];
    this._isPlaying   = false;

    if (this.recognizer) try { this.recognizer.stop(); } catch (_) {}

    for (const [, peer] of this.peers) peer.pc.close();
    this.peers.clear();

    if (this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: 'leave' }));
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.roomId  = null;
    this.peerId  = null;
    this._active = false;
    this.onStateChange('idle');
    this.onParticipantChange();
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  toggleMic() {
    this.micEnabled = !this.micEnabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => { t.enabled = this.micEnabled; });
    }
    if (!this.micEnabled) {
      this._wantSpeech = false;
      if (this.recognizer) try { this.recognizer.stop(); } catch (_) {}
    } else if (this._active) {
      this._wantSpeech = true;
      this._startSpeech();
    }
    return this.micEnabled;
  }

  toggleCamera() {
    this.cameraEnabled = !this.cameraEnabled;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => { t.enabled = this.cameraEnabled; });
    }
    return this.cameraEnabled;
  }

  setAvatarInterpreter(enabled) {
    this.avatarInterpreter = Boolean(enabled);
    if (!this.avatarInterpreter) this._speechQueue = [];
  }

  sendChat(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'chat', text, lang: this.speakLang }));
    // Show own chat immediately on right side — no translation needed
    this.onTranscript({
      speaker:    this.displayName,
      original:   text,
      translated: text,
      lang:       this.speakLang,
      self:       true,
      interim:    false,
      kind:       'chat',
    });
  }

  getLocalStream()   { return this.localStream; }
  getRemoteStreams() {
    return [...this.peers.entries()].map(([id, p]) => ({
      peerId: id, name: p.name, stream: p.stream,
    }));
  }

  // ── Media ──────────────────────────────────────────────────────────────────
  async _startLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
    } catch (_) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.cameraEnabled = false;
      } catch (e) {
        throw new Error(`Camera/mic blocked: ${e.name}`);
      }
    }
    this.onParticipantChange();
  }

  // ── Signaling ──────────────────────────────────────────────────────────────
  _wsUrl() {
    const base = this.brain.backend || '';
    if (base.startsWith('http')) {
      const u = new URL(base);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${u.origin}/ws/meeting/${this.roomId}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/meeting/${this.roomId}`;
  }

  _connectSignaling() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._wsUrl());
      this.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'join', name: this.displayName,
          speak_lang: this.speakLang, hear_lang: this.hearLang,
        }));
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          await this._handleSignal(msg);
          if (msg.type === 'joined') resolve();
        } catch (e) { console.warn('Signal parse error', e); }
      };

      ws.onerror  = () => reject(new Error('Meeting connection failed'));
      ws.onclose  = () => {
        if (this._active) { this.onError('Meeting disconnected'); this.leave(); }
      };

      setTimeout(() => reject(new Error('Meeting connection timeout')), 12000);
    });
  }

  async _handleSignal(msg) {
    switch (msg.type) {
      case 'joined':
        this.peerId = msg.peer_id;
        for (const peer of msg.peers || []) {
          await this._createPeerConnection(peer.peer_id, peer.name, peer.speak_lang, true);
        }
        this.onParticipantChange();
        break;
      case 'peer-joined':
        await this._createPeerConnection(msg.peer.peer_id, msg.peer.name, msg.peer.speak_lang, false);
        this.onParticipantChange();
        break;
      case 'peer-left':
        this._removePeer(msg.peer_id);
        this.onParticipantChange();
        break;
      case 'offer':      await this._handleOffer(msg);            break;
      case 'answer':     await this._handleAnswer(msg);           break;
      case 'ice':        await this._handleIce(msg);              break;
      case 'transcript': await this._handleRemoteTranscript(msg); break;
      case 'chat':       await this._handleRemoteChat(msg);       break;
      default: break;
    }
  }

  async _createPeerConnection(remoteId, name, speakLang, isInitiator) {
    if (this.peers.has(remoteId)) return;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    const entry = { pc, name, speakLang, stream: null };
    this.peers.set(remoteId, entry);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
    }

    pc.ontrack = (ev) => {
      entry.stream = ev.streams[0] || new MediaStream([ev.track]);
      this.onParticipantChange();
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ice', to: remoteId, candidate: ev.candidate }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this._removePeer(remoteId);
        this.onParticipantChange();
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws?.send(JSON.stringify({ type: 'offer', to: remoteId, sdp: offer }));
    }
  }

  async _handleOffer(msg) {
    const remoteId = msg.from;
    if (!this.peers.has(remoteId)) {
      await this._createPeerConnection(remoteId, 'Guest', 'en', false);
    }
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    await entry.pc.setRemoteDescription(msg.sdp);
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    this.ws?.send(JSON.stringify({ type: 'answer', to: remoteId, sdp: answer }));
  }

  async _handleAnswer(msg) {
    const entry = this.peers.get(msg.from);
    if (!entry) return;
    await entry.pc.setRemoteDescription(msg.sdp);
  }

  async _handleIce(msg) {
    const entry = this.peers.get(msg.from);
    if (!entry || !msg.candidate) return;
    try { await entry.pc.addIceCandidate(msg.candidate); } catch (_) {}
  }

  _removePeer(remoteId) {
    const entry = this.peers.get(remoteId);
    if (entry) { entry.pc.close(); this.peers.delete(remoteId); }
  }

  // ── Speech Recognition ────────────────────────────────────────────────────
  // KEY FIX: interim results shown LOCALLY ONLY — never broadcast to server.
  // Only FINAL results are broadcast. This eliminates duplicate bubbles.
  _initSpeechRecognition() {
    const Engine = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Engine) return;

    this.recognizer = new Engine();
    this.recognizer.continuous      = true;
    this.recognizer.interimResults  = true;
    this.recognizer.maxAlternatives = 1;
    this.recognizer.lang = SPEAK_LANG_MAP[this.speakLang] || 'en-US';

    this.recognizer.onresult = (e) => {
      let interim   = '';
      let finalText = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }

      // ── Interim: show locally only, replace in place, NEVER broadcast ──
      if (interim.trim()) {
        this.onTranscript({
          speaker:    this.displayName,
          original:   interim.trim(),
          translated: interim.trim(),
          lang:       this.speakLang,
          self:       true,
          interim:    true,   // panel replaces this bubble in place
          kind:       'speech',
        });
      }

      // ── Final: broadcast to server + show locally with translation ──────
      if (finalText.trim()) {
        this._broadcastTranscript(finalText.trim());
      }
    };

    this.recognizer.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'audio-capture') {
        this.onError('Microphone blocked in meeting');
        this._wantSpeech = false;
      }
    };

    this.recognizer.onend = () => {
      if (this._wantSpeech && this._active) {
        try { this.recognizer.start(); } catch (_) {}
      }
    };
  }

  _startSpeech() {
    if (!this.recognizer || !this.micEnabled) return;
    this.recognizer.lang = SPEAK_LANG_MAP[this.speakLang] || 'en-US';
    try { this.recognizer.start(); } catch (_) {}
  }

  // ── Broadcast final transcript to server ──────────────────────────────────
  _broadcastTranscript(text) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'transcript', text, lang: this.speakLang, final: true,
      }));
    }
    // Show own final bubble locally with translation
    this._showLocalFinal(text);
  }

  async _showLocalFinal(text) {
    let translated = text;
    if (this.speakLang !== this.hearLang) {
      try {
        translated = await _callTranslate(this.brain.backend, text, this.hearLang);
      } catch (_) {}
    }
    // Final bubble — NOT interim, so panel appends it permanently
    this.onTranscript({
      speaker:    this.displayName,
      original:   text,
      translated,
      lang:       this.speakLang,
      hearLang:   this.hearLang,
      self:       true,
      interim:    false,
      kind:       'speech',
    });
    if (this.avatarInterpreter && translated) {
      this._enqueueChunk(translated, this.hearLang);
    }
  }

  // ── Remote transcript handler ──────────────────────────────────────────────
  async _handleRemoteTranscript(msg) {
    const original   = msg.text || '';
    const sourceLang = msg.lang || 'en';
    let translated   = original;

    if (sourceLang !== this.hearLang) {
      try {
        translated = await _callTranslate(this.brain.backend, original, this.hearLang);
      } catch (_) { translated = original; }
    }

    this.onTranscript({
      speaker:    msg.name || 'Guest',
      original,
      translated,
      lang:       sourceLang,
      hearLang:   this.hearLang,
      self:       false,
      interim:    false,
      kind:       'speech',
    });

    if (this.avatarInterpreter && translated) {
      this._enqueueChunk(translated, this.hearLang);
    }
  }

  // ── Remote chat handler ────────────────────────────────────────────────────
  // msg.translated is already set by meeting.py per-peer — use it directly
  async _handleRemoteChat(msg) {
    const original   = msg.text       || '';
    const sourceLang = msg.lang       || 'en';
    // Use server-side translation if available, else translate client-side
    let translated   = msg.translated || original;

    if (!msg.translated && sourceLang !== this.hearLang) {
      try {
        translated = await _callTranslate(this.brain.backend, original, this.hearLang);
      } catch (_) { translated = original; }
    }

    this.onTranscript({
      speaker:    msg.name || 'Guest',
      original,
      translated,
      lang:       sourceLang,
      hearLang:   this.hearLang,
      self:       false,
      interim:    false,
      kind:       'chat',
    });
  }

  // ── Speech queue — continuous avatar interpreter ───────────────────────────
  _enqueueChunk(text, lang) {
    if (!text || !text.trim()) return;
    this._speechQueue.push({ text: text.trim(), lang });
    if (!this._isPlaying) this._drainQueue();
  }

  async _drainQueue() {
    if (this._isPlaying || this._speechQueue.length === 0) return;
    this._isPlaying = true;
    while (this._speechQueue.length > 0) {
      if (!this.avatarInterpreter) { this._speechQueue = []; break; }
      const chunk = this._speechQueue.shift();
      await this._speakChunk(chunk.text, chunk.lang);
    }
    this._isPlaying = false;
  }

  async _speakChunk(text, lang) {
    try {
      const data = await _callVoice(this.brain.backend, text, lang);
      if (!data || !data.audio_url) return;

      const audioUrl = data.audio_url.startsWith('http')
        ? data.audio_url
        : `${this.brain.backend}${data.audio_url}`;

      await new Promise((resolve) => {
        this.onInterpreterSpeech({
          audio_url: audioUrl,
          visemes:   data.visemes || [],
          lang,
          onDone:    resolve,
        });
        setTimeout(resolve, 8000);
      });
    } catch (e) {
      console.warn('Avatar interpreter TTS chunk failed:', e);
    }
  }
}