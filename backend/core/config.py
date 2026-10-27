from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    openai_api_key: str
    openai_model: str = "gpt-4o-mini"
    # Optional fallback provider (capstone §3.9.2 multi-provider fallback).
    # Used only when OpenAI fails or its circuit is open; blank = disabled.
    gemini_api_key: str = ""
    # The fallback sends prompts to a second provider; off unless explicitly enabled
    # (use a paid Gemini account so its data terms match OpenAI's API terms).
    gemini_enabled: bool = False
    gemini_model: str = "gemini-2.5-flash"
    # Superseded by the "mapping_review_threshold" institution setting; kept so old .env files load.
    topic_mapping_confidence_threshold: float = 0.75
    # Secret salt for student-ID hashing: SHA-256(Student_ID + Salt), capstone §3.9.1.
    # Changing it after data exists breaks the link between users and their scores.
    student_id_salt: str = ""
    tesseract_cmd: str = "tesseract"
    redis_url: str = "redis://localhost:6379/0"
    environment: str = "development"
    debug: bool = False

    # Email / SMTP
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = ""
    email_from_name: str = "AILAS – BTECH"

    class Config:
        env_file = ".env"
        extra = "ignore"  # .env also holds keys read elsewhere (POSTGRES_*, ADMIN_*)


settings = Settings()
