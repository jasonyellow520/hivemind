import os
from dotenv import load_dotenv

load_dotenv()

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY", "")
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY", "")
MINIMAX_MODEL = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7")

# iMessage Bridge settings
IMESSAGE_BRIDGE_URL = os.getenv("IMESSAGE_BRIDGE_URL", "http://localhost:3001")
IMESSAGE_ENABLED = os.getenv("IMESSAGE_ENABLED", "true").lower() == "true"

# Avoid SDK key-precedence confusion: prefer GEMINI_API_KEY in this app.
if GEMINI_API_KEY:
    os.environ.pop("GOOGLE_API_KEY", None)

QUEEN_MODEL = "gemini-3.1-pro-preview"
WORKER_MODEL = "gemini-3-flash-preview"
CHAT_MODEL = "gemini-3-flash-preview"

ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
ELEVENLABS_MODEL_ID = "eleven_flash_v2_5"

WS_HEARTBEAT_INTERVAL = 10
MAX_WORKERS = 10
BROWSER_HEADLESS = False
BROWSER_ENGINE = os.getenv("BROWSER_ENGINE", "browser-use").strip().lower()

# Agent execution limits
AGENT_MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "30"))
AGENT_TIMEOUT_SECONDS = int(os.getenv("AGENT_TIMEOUT_SECONDS", "600"))
AGENT_MAX_ACTIONS_PER_STEP = int(os.getenv("AGENT_MAX_ACTIONS_PER_STEP", "3"))
