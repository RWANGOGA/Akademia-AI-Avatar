import os
import json

# ==========================================
# 1. SETUP & CACHING
# ==========================================
CULTURE_DIR = os.path.join(os.path.dirname(__file__), "culture")
_culture_cache = {}

def _load_json(filename: str) -> dict:
    """Load a JSON file from the culture folder."""
    if filename in _culture_cache:
        return _culture_cache[filename]
    
    filepath = os.path.join(CULTURE_DIR, filename)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            _culture_cache[filename] = data
            return data
    except Exception as e:
        print(f"⚠️ Warning: {filename} failed to load: {e}")
        return {}

def get_characters() -> dict:
    return _load_json("characters.json")

def get_knowledge(country: str) -> dict:
    return _load_json(f"knowledge_{country}.json")

# ==========================================
# 2. SCENARIOS & PERSONAS
# ==========================================
PERSONAS = {
    "FirstMeeting": {
        "character": "Amara",
        "background": "office",
        "voice": "en-US",
        "context": "First business meeting in Kampala. Teach greetings, elders-first protocol, warm handshakes, small talk before business."
    },
    "Negotiation": {
        "character": "Kwame",
        "background": "office",
        "voice": "en-US",
        "context": "Negotiation with Ugandan partners. Teach relationship-first deal-making, why silence may not mean yes, building trust before numbers."
    },
    "SocialMeal": {
        "character": "Amara",
        "background": "lounge",
        "voice": "en-US",
        "context": "Social meal or hospitality in Uganda. Teach food customs, matooke, accepting tea, washing hands, sharing food builds relationships."
    },
    "MarketVisit": {
        "character": "Kwame",
        "background": "market",
        "voice": "en-US",
        "context": "Visiting a Kampala market (e.g. Owino). Teach respectful bargaining, building rapport with sellers, market norms."
    },
    "PreTrip": {
        "character": "Kenji",
        "background": "classroom",
        "voice": "en-US",
        "context": "Pre-trip briefing for Japanese investors flying to Uganda. Cover visa, health, currency, mobile money, phrases to learn, day-one mistakes."
    },
    "JapanPrep": {
        "character": "Yuki",
        "background": "tokyo",
        "voice": "ja-JP",
        "context": "Ugandan preparing to meet Japanese investors. Teach meishi ceremony, punctuality, structured meetings, indirect communication, decision time."
    },
}

SCENARIO_ALIASES = {
    "Tutor": "FirstMeeting",
    "Business": "Negotiation",
    "Casual": "SocialMeal"
}

CULTURE_MODE_HINTS = {
    "uganda": "Focus on helping the user understand UGANDAN culture, customs, and business etiquette.",
    "japan": "Focus on helping the user understand JAPANESE culture and what Japanese investors expect.",
    "compare": "Compare Uganda and Japan side by side — highlight differences in greetings, business style, time, and negotiation."
}

def resolve_scenario(key: str) -> str:
    """Convert legacy persona names to new scenario names."""
    return SCENARIO_ALIASES.get(key, key)

# ==========================================
# 3. CULTURAL FACT RETRIEVAL
# ==========================================
def relevant_culture_facts(user_text: str, culture_mode: str) -> str:
    """Keyword-match the user's input against the knowledge base."""
    text = (user_text or "").lower()
    
    # Decide which countries to search
    if culture_mode == "japan":
        countries = ["japan"]
    elif culture_mode == "compare":
        countries = ["uganda", "japan"]
    else:
        countries = ["uganda"]
    
    matched_facts = []
    
    for country in countries:
        kb = get_knowledge(country)
        topics = kb.get("topics", {})
        
        for topic_id, topic_data in topics.items():
            keywords = topic_data.get("keywords", [])
            facts = topic_data.get("facts", [])
            
            # Check if any keyword matches
            if any(kw.lower() in text for kw in keywords):
                for fact in facts[:3]:  # Top 3 facts per topic
                    if fact not in matched_facts:
                        matched_facts.append(fact)
    
    if not matched_facts:
        return "Use accurate, respectful cultural guidance based on your character's background."
    
    return "Verified cultural context (use when relevant):\n- " + "\n- ".join(matched_facts[:8])

# ==========================================
# 4. PROMPT BUILDER
# ==========================================
def build_character_system(scenario_key: str, culture_mode: str, user_text: str) -> str:
    """Build the complete system prompt for the LLM."""
    resolved_key = resolve_scenario(scenario_key)
    config = PERSONAS.get(resolved_key, PERSONAS["FirstMeeting"])
    character_name = config["character"]
    
    # Load character's base prompt
    characters = get_characters()
    char_data = characters.get(character_name, {})
    base_prompt = char_data.get("prompt", f"You are {character_name}, a cultural guide.")
    
    # Get scenario context and cultural facts
    scenario_context = config["context"]
    mode_hint = CULTURE_MODE_HINTS.get(culture_mode, CULTURE_MODE_HINTS["uganda"])
    facts = relevant_culture_facts(user_text, culture_mode)
    
    return (
        f"{base_prompt}\n\n"
        f"CURRENT SCENARIO: {scenario_context}\n"
        f"LEARNING FOCUS: {mode_hint}\n\n"
        f"{facts}\n\n"
        "You also direct a 3D avatar's body and face. After your reply, choose:\n"
        "- expression: 'neutral', 'happy', 'sad', 'surprised', 'thinking', 'relaxed'\n"
        "- gesture: 'idle', 'wave', 'nod', 'shake', 'explain', 'think', 'shrug'\n"
        "- animation: 'idle', 'talk', 'explain', 'wave', 'think', 'nod'\n"
        "Output ONLY JSON: {'reply': '<english text>', 'expression': '<expr>', 'gesture': '<gesture>', 'animation': '<anim>'}"
    )