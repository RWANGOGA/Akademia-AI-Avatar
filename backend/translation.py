import re
import json
from ai import call_llm, ai_available

def is_japanese(text: str) -> bool:
    """Detect if text contains Japanese characters."""
    return bool(re.search(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]", text))

async def translate_to_japanese(text: str) -> dict:
    """Translate English to Japanese with romanization."""
    if not ai_available():
        return {"japanese": text, "romanization": ""}
    
    try:
        raw = await call_llm([
            {
                "role": "system",
                "content": "You are an expert English-to-Japanese translator. Preserve meaning and nuance, use natural polite Japanese (です・ます). Output ONLY JSON with keys 'japanese' and 'romanization' (Hepburn romaji)."
            },
            {
                "role": "user",
                "content": f'English: "{text}"'
            }
        ], json_mode=True)
        
        return json.loads(raw)
    except Exception as e:
        print(f"EN->JA translation error: {e}")
        return {"japanese": text, "romanization": ""}

async def translate_to_english(text: str) -> str:
    """Translate Japanese to English."""
    if not ai_available():
        return text
    
    try:
        result = await call_llm([
            {
                "role": "system",
                "content": "You are an expert Japanese-to-English translator. Output ONLY the English translation — no quotes, no markdown, no explanation."
            },
            {
                "role": "user",
                "content": f'Japanese: "{text}"'
            }
        ])
        return result.strip().strip('"')
    except Exception as e:
        print(f"JA->EN translation error: {e}")
        return text