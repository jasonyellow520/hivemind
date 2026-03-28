"""
HIVEMIND Launcher — starts backend + frontend in one command.

Usage:
    python run.py
"""
import sys
import os
import asyncio
import subprocess
import signal

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")

BACKEND_PORT = int(os.getenv("PORT", "8081"))
FRONTEND_PORT = 5173

processes: list[subprocess.Popen] = []


def kill_all():
    for p in processes:
        try:
            p.terminate()
        except Exception:
            pass


def main():
    # Windows: use ProactorEventLoop for subprocess support
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    print(f"Starting HIVEMIND...")
    print(f"  Backend:  http://localhost:{BACKEND_PORT}")
    print(f"  Frontend: http://localhost:{FRONTEND_PORT}")
    print(f"  Press Ctrl+C to stop both.\n")

    # Start backend
    backend_python = os.path.join(BACKEND_DIR, "venv", "bin", "python")
    backend = subprocess.Popen(
        [backend_python, "run.py"],
        cwd=BACKEND_DIR,
    )
    processes.append(backend)

    # Start frontend
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=FRONTEND_DIR,
    )
    processes.append(frontend)

    # Wait for either to exit, or Ctrl+C
    try:
        while True:
            for p in processes:
                ret = p.poll()
                if ret is not None:
                    name = "Backend" if p == backend else "Frontend"
                    print(f"\n{name} exited with code {ret}. Stopping...")
                    kill_all()
                    sys.exit(ret)
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")
        kill_all()


if __name__ == "__main__":
    main()
