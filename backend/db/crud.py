from sqlalchemy.orm import Session
from db import models

# --- Session & Message CRUD ---
def create_session(db: Session, user_id: int, persona: str, culture_mode: str):
    db_session = models.ChatSession(user_id=user_id, persona=persona, culture_mode=culture_mode)
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session

def get_session_history(db: Session, session_id: int, limit: int = 8):
    messages = db.query(models.Message).filter(models.Message.session_id == session_id)\
        .order_by(models.Message.created_at.desc()).limit(limit).all()
    return [{"role": msg.role, "content": msg.content} for msg in reversed(messages)]

def save_message(db: Session, session_id: int, role: str, content: str, language: str = "en",
                 expression=None, gesture=None, animation=None, audio_url_en=None, audio_url_ja=None):
    db_message = models.Message(
        session_id=session_id, role=role, content=content, language=language,
        expression=expression, gesture=gesture, animation=animation,
        audio_url_en=audio_url_en, audio_url_ja=audio_url_ja
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

# --- Document CRUD ---
def save_document(db: Session, user_id: int, filename: str, file_path: str, extracted_text: str, file_type: str = "pdf"):
    db_doc = models.UserDocument(user_id=user_id, filename=filename, file_path=file_path, extracted_text=extracted_text, file_type=file_type)
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)
    return db_doc

# --- Audio Cache CRUD ---
def get_cached_audio(db: Session, text_hash: str):
    return db.query(models.AudioCache).filter(models.AudioCache.text_hash == text_hash).first()

def save_audio_cache(db: Session, text_hash: str, text_content: str, voice_name: str, language: str, file_path: str, visemes: list):
    db_audio = models.AudioCache(text_hash=text_hash, text_content=text_content, voice_name=voice_name, language=language, file_path=file_path, visemes=visemes)
    db.add(db_audio)
    db.commit()
    db.refresh(db_audio)
    return db_audio

# --- Progress CRUD ---
def update_progress(db: Session, user_id: int, scenario_name: str, is_completed: bool, score: float, badges: list):
    progress = db.query(models.UserProgress).filter(models.UserProgress.user_id == user_id, models.UserProgress.scenario_name == scenario_name).first()
    if not progress:
        progress = models.UserProgress(user_id=user_id, scenario_name=scenario_name)
        db.add(progress)
    
    progress.is_completed = is_completed
    progress.score = score
    progress.badges_earned = badges
    db.commit()
    db.refresh(progress)
    return progress