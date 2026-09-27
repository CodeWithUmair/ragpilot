import os

# Settings are validated on import; unit tests never reach these services.
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ragpilot_test")
os.environ.setdefault("AUTH_SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("REQUIRE_EMAIL_VERIFICATION", "false")
