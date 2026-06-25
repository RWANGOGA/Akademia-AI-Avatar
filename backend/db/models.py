from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Boolean, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from db.session import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="student")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    documents = relationship("UserDocument", back_populates="user", cascade="all, delete-orphan")

class ChatSession(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    persona = Column(String, default="FirstMeeting")
    culture_mode = Column(String, default="uganda")
    summary = Column(Text, nullable=True)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_active = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    user = relationship("User", back_populates="sessions")
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan", order_by="Message.created_at")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    language = Column(String, default="en")
    expression = Column(String, nullable=True)
    gesture = Column(String, nullable=True)
    animation = Column(String, nullable=True)
    audio_url_en = Column(String, nullable=True)
    audio_url_ja = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    session = relationship("ChatSession", back_populates="messages")

class UserDocument(Base):
    __tablename__ = "user_documents"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    extracted_text = Column(Text, nullable=True)
    file_type = Column(String, default="pdf")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    user = relationship("User", back_populates="documents")

class AudioCache(Base):
    __tablename__ = "audio_cache"
    id = Column(Integer, primary_key=True, index=True)
    text_hash = Column(String, unique=True, index=True, nullable=False)
    text_content = Column(Text, nullable=False)
    voice_name = Column(String, nullable=False)
    language = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    visemes = Column(JSON, nullable=True)
    access_count = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class UserProgress(Base):
    __tablename__ = "user_progress"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    scenario_name = Column(String, nullable=False)
    is_completed = Column(Boolean, default=False)
    score = Column(Float, default=0.0)
    badges_earned = Column(JSON, default=list)
    feedback_notes = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())