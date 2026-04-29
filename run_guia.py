import os
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PYTHON = sys.executable
REQUIRED_PACKAGES = {
    "cohere": "cohere",
    "dotenv": "python-dotenv",
    "edge_tts": "edge-tts",
    "flask": "Flask",
    "flask_cors": "flask-cors",
    "imageio_ffmpeg": "imageio-ffmpeg",
}
OPTIONAL_PACKAGES = {
    "whisper": "openai-whisper",
}


@dataclass
class Service:
    name: str
    command: list[str]
    port: int
    process: subprocess.Popen | None = None


def port_is_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def stream_output(service: Service) -> None:
    assert service.process is not None
    assert service.process.stdout is not None

    for line in service.process.stdout:
        print(f"[{service.name}] {line}", end="")


def start_service(service: Service, env: dict[str, str]) -> None:
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    service.process = subprocess.Popen(
        service.command,
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=creationflags,
    )

    thread = threading.Thread(target=stream_output, args=(service,), daemon=True)
    thread.start()


def stop_services(services: list[Service]) -> None:
    for service in services:
        process = service.process
        if process is None or process.poll() is not None:
            continue

        if os.name == "nt":
            process.terminate()
        else:
            process.send_signal(signal.SIGTERM)

    deadline = time.time() + 5
    for service in services:
        process = service.process
        if process is None:
            continue

        remaining = max(0.1, deadline - time.time())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            process.kill()


def build_services() -> list[Service]:
    llm_code = (
        "from LLM.LLM_Call import app; "
        "print('GuIA LLM API starting on http://127.0.0.1:5002', flush=True); "
        "app.run(host='127.0.0.1', port=5002, debug=False, use_reloader=False)"
    )

    return [
        Service(
            name="frontend",
            command=[
                PYTHON,
                "-m",
                "http.server",
                "8000",
                "--bind",
                "127.0.0.1",
                "--directory",
                str(ROOT / "frontend"),
            ],
            port=8000,
        ),
        Service(
            name="audio-api",
            command=[PYTHON, str(ROOT / "frontend" / "audio_api.py")],
            port=5000,
        ),
        Service(
            name="llm-api",
            command=[PYTHON, "-c", llm_code],
            port=5002,
        ),
    ]


def missing_packages(packages: dict[str, str]) -> list[str]:
    return [package for module, package in packages.items() if find_spec(module) is None]


def read_llm_env_file() -> dict[str, str]:
    env_file = ROOT / "LLM" / ".env"
    if not env_file.exists():
        return {}

    values = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        value = value.strip().strip('"').strip("'")
        key = key.strip()
        if key and value:
            values[key] = value

    return values


def read_cohere_key_from_env_file() -> str | None:
    return read_llm_env_file().get("COHERE_LLM_KEY")


def cohere_key_is_configured() -> bool:
    if os.getenv("COHERE_LLM_KEY"):
        return True

    return read_cohere_key_from_env_file() is not None


def check_dependencies() -> bool:
    missing_required = missing_packages(REQUIRED_PACKAGES)
    missing_optional = missing_packages(OPTIONAL_PACKAGES)

    if missing_required:
        print("The current Python environment is missing packages required to start GuIA:")
        for package in missing_required:
            print(f"  - {package}")
        print("")
        print("Install the project requirements, then run this command again:")
        print(f"  {PYTHON} -m pip install -r requirements.txt")
        return False

    if missing_optional:
        print("Optional voice transcription packages are missing:")
        for package in missing_optional:
            print(f"  - {package}")
        print("The app can start, but microphone transcription will fail until they are installed.")
        print("")

    if not cohere_key_is_configured():
        print("COHERE_LLM_KEY is not configured.")
        print("Create LLM/.env with this value before starting the app:")
        print("  COHERE_LLM_KEY=your_key_here")
        return False

    return True


def main() -> int:
    if not check_dependencies():
        return 1

    services = build_services()
    busy_ports = [service for service in services if port_is_busy(service.port)]

    if busy_ports:
        print("Cannot start GuIA because these ports are already in use:")
        for service in busy_ports:
            print(f"  - {service.name}: 127.0.0.1:{service.port}")
        print("Stop the old processes and run this command again.")
        return 1

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    for key, value in read_llm_env_file().items():
        env.setdefault(key, value)

    print("Starting GuIA services...")
    for service in services:
        start_service(service, env)

    print("")
    print("GuIA is starting. Open the app at:")
    print("  http://127.0.0.1:8000")
    print("")
    print("Press Ctrl+C here to stop all services.")
    print("")

    try:
        while True:
            for service in services:
                process = service.process
                if process is not None and process.poll() is not None:
                    print("")
                    print(f"{service.name} exited with code {process.returncode}. Stopping the rest.")
                    return 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("")
        print("Stopping GuIA services...")
        return 0
    finally:
        stop_services(services)


if __name__ == "__main__":
    raise SystemExit(main())
