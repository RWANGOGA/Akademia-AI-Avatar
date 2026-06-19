# Akademia AI Avatar

An AI-powered multilingual interactive human avatar. A user talks (text or
voice); the backend (the **brain**) calls ChatGPT, translates, synthesizes
speech with a lip-sync timeline, and returns one behavior JSON. The frontend
(the **body**) maps that behavior onto a 3D VRM avatar: facial expression,
gestures, mouth lip-sync, voice and background.

```
USER ──► Frontend (main.js) ──► FastAPI ──► ChatGPT + Translation + Edge-TTS
                                   │
                          AI behavior JSON
                                   │
      ┌────────────┬──────────────┬──────────────┐
   Expression    Gesture        LipSync       Background
   (face)        (body)         (mouth+voice) (world)
```

## Architecture

The avatar is the **body**: it does not think, it only receives instructions.

```
backend.py             ai-avatar-web/
  /ask     brain         main.js              conductor (wires everything)
  /translate             src/avatar/
  /voice                   AvatarManager.js   loads/positions the VRM
  /upload-face             ExpressionEngine.js face (emotion + blink)
  /reset                   GestureEngine.js   body (arms/head/torso)
  /health                  LipSync.js         mouth synced to audio
                         src/ai/CharacterBrain.js   talks to the backend
                         src/systems/PersonaSystem.js / BackgroundSystem.js / TranslationSystem.js
                         src/ui/Controls.js   all DOM/button wiring
```

### Behavior JSON contract (`/ask` response)
```json
{
  "reply": "Hello! Let's study Japanese together.",
  "translated_reply": "こんにちは！…",
  "romanization": "konnichiwa! …",
  "expression": "happy",
  "gesture": "wave",
  "voice": "ja-JP-NanamiNeural",
  "background": "classroom",
  "primary": "en",
  "audio_url_en": "/static/en_1.mp3",
  "audio_url_ja": "/static/ja_1.mp3",
  "visemes_en": [{ "t": 120, "v": "aa" }],
  "visemes_ja": [{ "t": 110, "v": "oh" }]
}
```

## Setup

### 1. Backend
```bash
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env                # then put your real key in .env
export OPENAI_API_KEY=sk-...        # Windows: set OPENAI_API_KEY=sk-...

uvicorn backend:app --reload --port 8000
```
Without a key the backend still runs and returns an offline echo (no ChatGPT).

### 2. Frontend
```bash
cd ai-avatar-web
npm install
npm run dev                         # http://localhost:5173
```
Vite proxies `/ask`, `/translate`, `/voice`, `/static`, etc. to `localhost:8000`.

### 3. Avatars
Put `.vrm` files in `ai-avatar-web/public/assets/avatars/`:
`uganda-male.vrm`, `uganda-female.vrm`, `japan-male.vrm`, `japan-female.vrm`.
Backgrounds (optional) go in `public/assets/backgrounds/` (gradients are used as fallback).

## Avatar creator
The studio embeds **Ready Player Me** (realistic GLB) and links to **VRoid Hub**
(anime VRM). Ready Player Me avatars are loaded automatically on export; VRoid
models are downloaded manually and dropped into `public/assets/avatars/`.
