from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "herd"
    postgres_password: str
    postgres_db: str = "herd_db"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    gemini_api_key: str = ""
    supabase_url: str = ""
    supabase_anon_key: str = ""

    n_peers_default: int = 20

    class Config:
        env_file = ".env"


settings = Settings()
