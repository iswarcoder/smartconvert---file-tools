import os
from io import BytesIO

import requests
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

API_SECRET = os.getenv("CONVERT_API_SECRET")
CONVERT_API_URL = "https://v2.convertapi.com/convert/docx/to/pdf"


@app.route("/", methods=["GET"])
def home():
    return "Backend running 🚀"


@app.route("/api/tools", methods=["GET"])
def tools():
    return jsonify({"message": "API working"})


def convert_docx_to_pdf(uploaded_file):
    if not API_SECRET:
        return None, {"error": "API secret missing"}

    filename = secure_filename(uploaded_file.filename or "document.docx")
    uploaded_file.stream.seek(0)

    files = {"File": (filename, uploaded_file.stream)}
    data = {"Secret": API_SECRET}

    response = requests.post(CONVERT_API_URL, files=files, data=data, timeout=120)
    print("ConvertAPI response:", response.text)

    try:
        response_data = response.json()
    except ValueError:
        print("ConvertAPI error:", response.text)
        return None, {
            "error": "ConvertAPI failed",
            "details": response.text,
        }

    print("ConvertAPI response JSON:", response_data)

    if not response.ok:
        print("ConvertAPI error:", response_data)
        return None, {
            "error": "ConvertAPI failed",
            "details": response_data,
        }

    output_files = response_data.get("Files", [])
    if not output_files:
        return None, {
            "error": "ConvertAPI failed",
            "details": response_data,
        }

    download_url = output_files[0].get("Url") or output_files[0].get("url")
    if not download_url:
        return None, {
            "error": "ConvertAPI failed",
            "details": response_data,
        }

    pdf_response = requests.get(download_url, timeout=120)
    print("ConvertAPI download response:", pdf_response.status_code)

    if not pdf_response.ok:
        return None, {
            "error": "ConvertAPI failed",
            "details": pdf_response.text,
        }

    return pdf_response.content, None


@app.route("/api/convert", methods=["POST"])
def convert_file():
    try:
        try:
            file = request.files["file"]
        except KeyError:
            return jsonify({"error": "No file uploaded"}), 400

        if not file or not file.filename:
            return jsonify({"error": "No file uploaded"}), 400

        if not API_SECRET:
            return jsonify({"error": "API secret missing"}), 500

        print("API SECRET:", API_SECRET[:10] if API_SECRET else "NOT FOUND")

        filename = file.filename
        input_format = filename.split(".")[-1].lower() if "." in filename else ""

        print("Filename:", filename)
        print("Detected format:", input_format)

        if input_format != "docx":
            return jsonify({"error": "Only DOCX to PDF conversion is supported"}), 400

        pdf_bytes, error = convert_docx_to_pdf(file)
        if error:
            return jsonify(error), 500

        output_name = f"{filename.rsplit('.', 1)[0]}.pdf"
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=output_name,
        )

    except requests.RequestException as exc:
        print("ERROR:", str(exc))
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:
        print("ERROR:", str(exc))
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
