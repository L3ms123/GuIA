from flask import Flask, request, jsonify
import whisper
import tempfile
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Habilitar CORS para todas las rutas

model = whisper.load_model("base")  # puedes usar "tiny" si va lento

@app.route('/transcribe', methods=['POST'])
def transcribe():
    audio = request.files['file']
    lang = request.form.get('lang', 'auto')

    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        audio.save(tmp.name)

        result = model.transcribe(tmp.name, language=lang)  # especifica el idioma si es necesario

    return jsonify({"text": result["text"]})

if __name__ == '__main__':
    app.run(debug=True)