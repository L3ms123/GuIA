import os
from pathlib import Path

from flask import Response, send_from_directory

from LLM.LLM_Call import app
from frontend.audio_api import app as audio_app


ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"


def register_audio_routes() -> None:
    for rule in audio_app.url_map.iter_rules():
        if rule.endpoint == "static":
            continue

        app.add_url_rule(
            rule.rule,
            endpoint=f"audio_{rule.endpoint}",
            view_func=audio_app.view_functions[rule.endpoint],
            methods=sorted(rule.methods - {"HEAD", "OPTIONS"}),
        )


register_audio_routes()


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/favicon.ico")
def favicon():
    return Response(status=204)


@app.route("/<path:filename>")
def frontend_file(filename):
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "7860"))
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
