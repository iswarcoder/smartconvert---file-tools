import os
import time

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

CLOUDCONVERT_API_KEY = os.getenv("CLOUDCONVERT_API_KEY")


@app.route("/", methods=["GET"])
def home():
    return "Backend running 🚀"


@app.route("/api/tools", methods=["GET"])
def tools():
    return jsonify({"message": "API working"})


def create_cloudconvert_download_url(uploaded_file):
    if not CLOUDCONVERT_API_KEY:
        return None, {"error": "API key missing"}

    print("API KEY:", CLOUDCONVERT_API_KEY[:10] if CLOUDCONVERT_API_KEY else "NOT FOUND")

    headers = {
        "Authorization": f"Bearer {CLOUDCONVERT_API_KEY}",
        "Content-Type": "application/json",
    }

    job_data = {
        "tasks": {
            "import-1": {"operation": "import/upload"},
            "convert-1": {
                "operation": "convert",
                "input": "import-1",
                "input_format": "docx",
                "output_format": "pdf",
            },
            "export-1": {
                "operation": "export/url",
                "input": "convert-1",
            },
        }
    }

    response = requests.post(
        "https://api.cloudconvert.com/v2/jobs",
        json=job_data,
        headers=headers,
        timeout=60,
    )
    print("CloudConvert response:", response.text)

    if response.status_code != 201:
        print("CloudConvert error:", response.text)
        return None, {"error": "CloudConvert failed", "details": response.text}

    response_data = response.json()
    upload_task = next((t for t in response_data.get("data", {}).get("tasks", []) if t.get("name") == "import-1"), None)
    if not upload_task:
        return None, {"error": "CloudConvert failed", "details": "Upload task not found"}

    upload_form = upload_task.get("result", {}).get("form", {})
    upload_url = upload_form.get("url")
    upload_parameters = upload_form.get("parameters", {})
    if not upload_url:
        return None, {"error": "CloudConvert failed", "details": "Upload URL missing"}

    uploaded_file.stream.seek(0)
    upload_response = requests.post(
        upload_url,
        data=upload_parameters,
        files={"file": (uploaded_file.filename, uploaded_file.stream)},
        timeout=60,
    )

    if upload_response.status_code not in (200, 201, 204):
        print("CloudConvert error:", upload_response.text)
        return None, {"error": "CloudConvert failed", "details": upload_response.text}

    job_id = response_data["data"]["id"]

    for _ in range(24):
        time.sleep(5)
        job_response = requests.get(
            f"https://api.cloudconvert.com/v2/jobs/{job_id}",
            headers=headers,
            timeout=60,
        )

        if job_response.status_code != 200:
            print("CloudConvert error:", job_response.text)
            return None, {"error": "CloudConvert failed", "details": job_response.text}

        status = job_response.json()
        if status.get("data", {}).get("status") == "finished":
            export_task = next((t for t in status.get("data", {}).get("tasks", []) if t.get("name") == "export-1"), None)
            if not export_task:
                print("CloudConvert error:", job_response.text)
                return None, {"error": "CloudConvert failed", "details": "Export task not found"}
            files = export_task.get("result", {}).get("files", [])
            if files:
                return files[0].get("url"), None
        elif status.get("data", {}).get("status") == "error":
            print("CloudConvert error:", job_response.text)
            return None, {"error": "CloudConvert failed", "details": job_response.text}

    return None, {
        "error": "CloudConvert failed",
        "details": "CloudConvert conversion timed out",
    }


@app.route("/api/convert", methods=["POST"])
def convert_file():
    try:
        if not CLOUDCONVERT_API_KEY:
            return jsonify({"error": "API key missing"}), 500

        print("API KEY:", CLOUDCONVERT_API_KEY[:10] if CLOUDCONVERT_API_KEY else "NOT FOUND")

        if "file" not in request.files:
            return jsonify({"error": "File is required"}), 400

        uploaded_file = request.files["file"]
        if not uploaded_file.filename:
            return jsonify({"error": "File is required"}), 400

        filename = secure_filename(uploaded_file.filename)
        if os.path.splitext(filename)[1].lstrip(".").lower() != "docx":
            return jsonify({"error": "Only DOCX to PDF conversion is supported"}), 400

        download_url, error = create_cloudconvert_download_url(uploaded_file)
        if error:
            return jsonify(error), 500

        return jsonify({"download_url": download_url}), 200

    except requests.RequestException as exc:
        print("ERROR:", str(exc))
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:
        print("ERROR:", str(exc))
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
