/**
 * LiveMeetingSystem — WebRTC mesh calls with live translation.
 *
 * Flow:
 *  1. Create/join room via WebSocket signaling (/ws/meeting/{room_id})
 *  2. WebRTC audio+video between participants (mesh, best for 2–6 people)
 *  3. Local speech recognition → broadcast transcript
 *  4. Each client translates incoming speech to their hear_lang
 *  5. Optional avatar interpreter via /voice TTS + visemes
 */
const SPEAK_LANG_MAP = {
  en: 'en-US',
  ja: 'ja-JP',
  luganda: 'en-US', // browser STT has no Luganda — use English fallback
};

export class LiveMeetingSystem {
  constructor(brain, callbacks = {}) {
    this.brain = brain;
    this.onStateChange = callbacks.onStateChange || (() => {});
    this.onTranscript = callbacks.onTranscript || (() => {});
    this.onParticipantChange = callbacks.onParticipantChange || (() => {});
    this.onInterpreterSpeech = callbacks.onInterpreterSpeech || (() => {});
    this.onError = callbacks.onError || (() => {});

    this.roomId = null;
    this.peerId = null;
    this.displayName = 'Guest';
    this.speakLang = 'en';
    this.hearLang = 'ja';
    this.avatarInterpreter = false;
    this.cameraEnabled = true;
    this.micEnabled = true;

    this.ws = null;
    this.localStream = null;
    this.peers = new Map(); // remotePeerId -> { pc, name, speakLang }
    this.recognizer = null;
    this._wantSpeech = false;
    this._active = false;
    this._interpreterBusy = false;
  }

  get isActive() {
    return this._active;
  }

  get participantCount() {
    return this.peers.size + (this.localStream ? 1 : 0);
  }

  async createRoom() {
    const res = await fetch(`${this.brain.backend}/meeting/create`);
    if (!res.ok) throw new Error('Could not create meeting room');
    const data = await res.json();
    return data.room_id;
  }

  async join(roomId, { name, speakLang, hearLang, avatarInterpreter }) {
    if (this._active) await this.leave();

    this.roomId = (roomId || '').trim().toUpperCase();
    if (!this.roomId) throw new Error('Enter a room code');

    this.displayName = (name || 'Guest').trim().slice(0, 40) || 'Guest';
    this.speakLang = speakLang || 'en';
    this.hearLang = hearLang || 'ja';
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
    this._wantSpeech = false;
    if (this.recognizer) {
      try { this.recognizer.stop(); } catch (_) {}
    }

    for (const [, peer] of this.peers) {
      peer.pc.close();
    }
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

    this.roomId = null;
    this.peerId = null;
    this._active = false;
    this.onStateChange('idle');
    this.onParticipantChange();
  }

  toggleMic() {
    this.micEnabled = !this.micEnabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = this.micEnabled;
      });
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
      this.localStream.getVideoTracks().forEach((t) => {
        t.enabled = this.cameraEnabled;
      });
    }
    return this.cameraEnabled;
  }

  setAvatarInterpreter(enabled) {
    this.avatarInterpreter = Boolean(enabled);
  }

  sendChat(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'chat',
      text,
      lang: this.speakLang,
    }));
    this.onTranscript({
      speaker: this.displayName,
      original: text,
      translated: text,
      lang: this.speakLang,
      self: true,
      kind: 'chat',
    });
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStreams() {
    return [...this.peers.entries()].map(([id, p]) => ({
      peerId: id,
      name: p.name,
      stream: p.stream,
    }));
  }

  // ── Media ────────────────────────────────────────────────────────────────
  async _startLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
    } catch (err) {
      // Fall back to audio-only if camera blocked
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.cameraEnabled = false;
      } catch (e) {
        throw new Error(`Camera/mic blocked: ${e.name}`);
      }
    }
    this.onParticipantChange();
  }

  // ── Signaling ──────────────────────────────────────────────────────────
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
          type: 'join',
          name: this.displayName,
          speak_lang: this.speakLang,
          hear_lang: this.hearLang,
        }));
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          await this._handleSignal(msg);
          if (msg.type === 'joined') resolve();
        } catch (e) {
          console.warn('Signal parse error', e);
        }
      };

      ws.onerror = () => {
        reject(new Error('Meeting connection failed'));
      };

      ws.onclose = () => {
        if (this._active) {
          this.onError('Meeting disconnected');
          this.leave();
        }
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

      case 'offer':
        await this._handleOffer(msg);
        break;

      case 'answer':
        await this._handleAnswer(msg);
        break;

      case 'ice':
        await this._handleIce(msg);
        break;

      case 'transcript':
        await this._handleRemoteTranscript(msg);
        break;

      case 'chat':
        await this._handleRemoteChat(msg);
        break;

      default:
        break;
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
        this.ws.send(JSON.stringify({
          type: 'ice',
          to: remoteId,
          candidate: ev.candidate,
        }));
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
      this.ws?.send(JSON.stringify({
        type: 'offer',
        to: remoteId,
        sdp: offer,
      }));
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
    this.ws?.send(JSON.stringify({
      type: 'answer',
      to: remoteId,
      sdp: answer,
    }));
  }

  async _handleAnswer(msg) {
    const entry = this.peers.get(msg.from);
    if (!entry) return;
    await entry.pc.setRemoteDescription(msg.sdp);
  }

  async _handleIce(msg) {
    const entry = this.peers.get(msg.from);
    if (!entry || !msg.candidate) return;
    try {
      await entry.pc.addIceCandidate(msg.candidate);
    } catch (_) {}
  }

  _removePeer(remoteId) {
    const entry = this.peers.get(remoteId);
    if (entry) {
      entry.pc.close();
      this.peers.delete(remoteId);
    }
  }

  // ── Speech + translation ─────────────────────────────────────────────────
  _initSpeechRecognition() {
    const Engine = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Engine) return;

    this.recognizer = new Engine();
    this.recognizer.continuous = true;
    this.recognizer.interimResults = true;
    this.recognizer.maxAlternatives = 1;
    this.recognizer.lang = SPEAK_LANG_MAP[this.speakLang] || 'en-US';

    this.recognizer.onresult = (e) => {
      let interim = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (finalText.trim()) {
        this._broadcastTranscript(finalText.trim(), true);
      } else if (interim.trim()) {
        this.onTranscript({
          speaker: this.displayName,
          original: interim.trim(),
          translated: interim.trim(),
          lang: this.speakLang,
          self: true,
          interim: true,
          kind: 'speech',
        });
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
    try {
      this.recognizer.start();
    } catch (_) {}
  }

  _broadcastTranscript(text, final) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'transcript',
        text,
        lang: this.speakLang,
        final,
      }));
    }
    this._showLocalTranscript(text, final);
  }

  async _showLocalTranscript(text, final) {
    let translated = text;
    if (this.speakLang !== this.hearLang) {
      try {
        translated = await this._translate(text, this.speakLang, this.hearLang);
      } catch (_) {}
    }
    this.onTranscript({
      speaker: this.displayName,
      original: text,
      translated,
      lang: this.speakLang,
      hearLang: this.hearLang,
      self: true,
      kind: 'speech',
    });
    if (this.avatarInterpreter && final) {
      await this._speakInterpreter(translated, this.hearLang);
    }
  }

  async _handleRemoteTranscript(msg) {
    const original = msg.text || '';
    const sourceLang = msg.lang || 'en';
    let translated = original;

    if (sourceLang !== this.hearLang) {
      try {
        translated = await this._translate(original, sourceLang, this.hearLang);
      } catch (_) {
        translated = original;
      }
    }

    this.onTranscript({
      speaker: msg.name || 'Guest',
      original,
      translated,
      lang: sourceLang,
      hearLang: this.hearLang,
      self: false,
      kind: 'speech',
    });

    if (this.avatarInterpreter && msg.final) {
      await this._speakInterpreter(translated, this.hearLang);
    }
  }

  async _handleRemoteChat(msg) {
    const original = msg.text || '';
    let translated = original;
    const sourceLang = msg.lang || 'en';

    if (sourceLang !== this.hearLang) {
      try {
        translated = await this._translate(original, sourceLang, this.hearLang);
      } catch (_) {
        translated = original;
      }
    }

    this.onTranscript({
      speaker: msg.name || 'Guest',
      original,
      translated,
      lang: sourceLang,
      hearLang: this.hearLang,
      self: false,
      kind: 'chat',
    });
  }

  async _translate(text, fromLang, toLang) {
    if (!text) return '';
    if (fromLang === toLang) return text;

    if (toLang === 'ja') {
      const r = await this.brain.translate(text, 'ja');
      return r.text || text;
    }
    if (toLang === 'en') {
      const r = await this.brain.translate(text, 'en');
      return r.text || text;
    }
    // luganda or other → translate via English first
    const en = fromLang === 'ja'
      ? (await this.brain.translate(text, 'en')).text
      : text;
    if (toLang === 'luganda') {
      return en; // placeholder until Luganda TTS/STT pipeline exists
    }
    return en;
  }

  async _speakInterpreter(text, lang) {
    if (!text || this._interpreterBusy) return;
    this._interpreterBusy = true;
    try {
      const culture = lang === 'ja' ? 'ja' : 'en';
      const voice = lang === 'ja' ? 'ja-JP' : 'en-US';
      const data = await this.brain.voice(text, voice, culture);
      this.onInterpreterSpeech(data);
    } catch (e) {
      console.warn('Interpreter TTS failed', e);
    } finally {
      this._interpreterBusy = false;
    }
  }
}
