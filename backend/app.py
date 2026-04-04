import os
import tempfile
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

API_SECRET = os.getenv("CONVERT_API_SECRET")


@app.route("/", methods=["GET"])
def home():
    return "Backend running 🚀"


@app.route("/api/tools", methods=["GET"])
def tools():
    return jsonify({"message": "API working"})

@app.route("/api/convert", methods=["POST"])
def convert_file():
    try:
        print("FILES:", request.files)
        print("API KEY:", os.getenv("CONVERT_API_SECRET"))

        try:
            file = request.files["file"]
        except KeyError:
            return jsonify({"error": "No file uploaded"}), 400

        if not file or not file.filename:
            return jsonify({"error": "No file uploaded"}), 400

        # Save file temporarily
        temp_input = tempfile.NamedTemporaryFile(delete=False, suffix=".docx")
        file.save(temp_input.name)

        # ConvertAPI request
        url = "https://v2.convertapi.com/convert/docx/to/pdf"

        with open(temp_input.name, "rb") as f:
            response = requests.post(
                url,
                files={"File": f},
                data={"Secret": os.getenv("CONVERT_API_SECRET")}
            )

        print("ConvertAPI raw response:", response.text)

        try:
            data = response.json()
            print("ConvertAPI response JSON:", data)
        except ValueError:
            return jsonify({"error": "ConvertAPI returned invalid JSON", "details": response.text}), 500

        # Check error
        if not response.ok:
            return jsonify({"error": "ConvertAPI failed", "details": data}), response.status_code

        if "Files" not in data or not data["Files"]:
            return jsonify({"error": "ConvertAPI failed", "details": data}), 500

        pdf_url = data["Files"][0]["Url"]

        if not pdf_url:
            return jsonify({"error": "ConvertAPI failed", "details": data}), 500

        # Download PDF
        pdf_response = requests.get(pdf_url)

        if not pdf_response.ok:
            return jsonify({"error": "PDF download failed", "details": pdf_response.text}), 500

        temp_output = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        temp_output.write(pdf_response.content)
        temp_output.close()

        return send_file(
            temp_output.name,
            as_attachment=True,
            download_name="converted.pdf"
        )

    except Exception as e:
        print("ERROR:", str(e))
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)