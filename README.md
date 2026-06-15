# Akademia AI Avatar: Multilingual 3D/2D Virtual Assistant

Welcome to the Akademia AI Avatar project. This repository contains the complete source code for an interactive, multilingual virtual assistant built from scratch. It combines a 3D VRM character with a 2D photo mode, featuring real-time frequency-based lip-sync, conversational memory, dynamic personas, and voice transcription.

## Project Overview

This project was developed to demonstrate how modern web technologies and AI APIs can be combined to create an engaging, accessible virtual assistant. Instead of just displaying text, the avatar actively listens (via audio upload), thinks (via OpenAI), and speaks back in two languages sequentially, with its mouth moving in real-time to match the audio frequencies.

## Key Features

- Conversational Memory: The AI retains context, remembering the user's name and previous questions throughout the session.
- Dynamic Personas: Users can switch between a Friendly Tutor, a Professional Business Guide, or a Casual Friend. The AI's tone, vocabulary, and visual styling adapt instantly.
- Multilingual Sequential Speech: The avatar answers in clear English first, then seamlessly translates and speaks the response in Japanese.
- Real-Time Frequency Lip-Sync: Uses the Web Audio API to analyze audio frequencies (not just volume) to drive accurate 3D mouth shapes and 2D image scaling effects.
- Voice Transcription: Users can upload audio files (.m4a, .mp3, .wav), which are transcribed into text using OpenAI Whisper, allowing for voice interaction without live microphone permissions.
- 2D Photo Mode: Users can upload any face photo. The system applies dynamic glowing auras and a "jaw-bob" animation synchronized to the speech.

## Tech Stack

Backend: Python 3.9+, FastAPI, OpenAI API (GPT-4o and Whisper), Edge-TTS
Frontend: JavaScript (ES6+), Three.js, Vite, @pixiv/three-vrm, Web Audio API

## File Structure and Descriptions

ai_avatar/
│
├── backend.py                    
    The core backend server. It handles incoming requests, manages conversation history, calls the OpenAI API for text generation and translation, generates audio via Edge-TTS, and processes audio uploads using Whisper.
│
├── requirements.txt              
    A list of all Python packages required to run the backend. Allows for one-command installation.
│
├── .env                          
    A local configuration file that stores your OpenAI API key. This file is strictly ignored by Git to protect your credentials.
│
├── .gitignore                    
    Tells Git which files and directories to ignore during commits, protecting secrets and preventing massive dependency folders from being uploaded.
│
├── README.md                     
    This documentation file.
│
├── static/                       
    A temporary directory where the backend saves generated audio files (.mp3) and uploaded user audio before processing.
│
├── venv/                         
    The Python virtual environment. It isolates the project's dependencies from the rest of your system.
│
└── ai-avatar-web/                
    The frontend web application.
    │
    ├── index.html                
        The structural layout of the website. It defines the 3D canvas, the hidden 2D photo container, the control inputs, and the CSS styling for auras and badges.
    │
    ├── main.js                   
        The core frontend logic. It initializes the Three.js scene, loads the VRM model, sets up the Web Audio API for lip-sync analysis, handles the animation loop, manages persona visual updates, and communicates with the Python backend.
    │
    ├── package.json              
        Lists all JavaScript dependencies and npm scripts for the frontend.
    │
    ├── vite.config.js            
        Configuration file for Vite, the build tool and development server.
    │
    └── public/
        └── avatar.vrm            
            The 3D model file of the avatar. This must be placed here for the frontend to load it.

## Installation and Setup

### Prerequisites
- Python 3.9 or higher installed on your machine.
- Node.js (v18 or higher) and npm installed.
- An active OpenAI API Key with access to GPT-4o and Whisper models.

### Step 1: Clone the Repository
Open your terminal and run:
git clone https://github.com/RWANGOGA/Akademia-AI-Avatar.git
cd Akademia-AI-Avatar

### Step 2: Backend Setup
1. Create and activate a Python virtual environment:
   # For Mac/Linux
   python3 -m venv venv
   source venv/bin/activate
   
   # For Windows
   python -m venv venv
   venv\Scripts\activate

2. Install the required Python packages:
   pip install -r requirements.txt

3. Configure your API Key:
   Create a new file named `.env` in the root directory (next to backend.py). Add your key exactly like this:
   OPENAI_API_KEY=sk-your-actual-openai-key-here
   (Note: Never commit this file to GitHub. It is protected by .gitignore).

### Step 3: Frontend Setup
1. Open a second terminal window.
2. Navigate to the web directory:
   cd ai-avatar-web
3. Install the JavaScript dependencies:
   npm install
4. Add your 3D model:
   Place your .vrm file inside the ai-avatar-web/public/ folder and name it exactly avatar.vrm.

## Running the Project

You must run two servers simultaneously: one for the backend and one for the frontend.

Terminal 1: Start the Python Backend
Ensure you are in the root 'ai_avatar' directory and your virtual environment is active.
uvicorn backend:app --reload --port 8000

Terminal 2: Start the Vite Frontend
Ensure you are in the 'ai-avatar-web' directory.
npm run dev

Once both are running, open your web browser and navigate to: http://localhost:5173/

## How to Use the Application

1. Select a persona from the dropdown menu (Tutor, Business, or Casual).
2. Type a question into the text input, or click the file upload button to upload a short audio recording of your voice.
3. Click "Ask & Speak".
4. The application will process the input, display the English and Japanese text responses on screen, and play the audio sequentially. The avatar's mouth will animate in real-time to match the speech.
5. To try the 2D mode, click the image upload button, select a photo, and toggle the mode switch at the top right of the screen.

## API Endpoints

POST /ask
Receives user text and persona preference, returns the generated English text, Japanese translation, and URLs to the generated audio files.

POST /transcribe
Accepts a multipart form-data request containing an audio file. Returns the transcribed text using OpenAI Whisper.

GET /audio_en and GET /audio_ja
Serves the generated MP3 audio files to the frontend.

## Customization

- Changing Personalities: Edit the 'personas' dictionary in backend.py to adjust the system prompts for each mode.
- Changing Voices: Modify the voice codes in backend.py (e.g., change "en-US-AriaNeural" to "en-US-GuyNeural").
- Changing Visuals: Adjust the CSS colors and the updateCharacterVisuals() function in main.js to change the aura colors for each persona.

## Contributing

If you are cloning this repository to learn or contribute, please ensure you create your own .env file with your own valid OpenAI API key, as the repository does not include one. 

## License

This project is licensed under the MIT License. It is free to use for educational and demonstration purposes.

## Acknowledgments

- Three.js and @pixiv/three-vrm for 3D rendering and model loading.
- OpenAI for GPT-4o and Whisper API capabilities.
- Edge-TTS for high-quality, free text-to-speech generation.
- FastAPI and Vite for robust and fast development environments.