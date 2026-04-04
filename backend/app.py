import os
import tempfile
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


def create_cloudconvert_download_url(file_path):
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
    tasks = response_data.get("data", {}).get("tasks", [])
    upload_task = next((task for task in tasks if task.get("name") == "import-1"), None)
    if not upload_task:
        return None, {"error": "CloudConvert failed", "details": "Upload task not found"}

    upload_form = upload_task.get("result", {}).get("form", {})
    upload_url = upload_form.get("url")
    upload_parameters = upload_form.get("parameters", {})
    if not upload_url:
        return None, {"error": "CloudConvert failed", "details": "Upload URL missing"}

    with open(file_path, "rb") as file_handle:
        upload_response = requests.post(
            upload_url,
            data=upload_parameters,
            files={"file": file_handle},
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

        job_data_response = job_response.json()
        job_tasks = job_data_response.get("data", {}).get("tasks", [])

        failed_task = next((task for task in job_tasks if task.get("status") == "error"), None)
        if failed_task:
            print("CloudConvert error:", failed_task)
            return None, {"error": "CloudConvert failed", "details": failed_task.get("message", "Unknown error")}

        export_task = next((task for task in job_tasks if task.get("name") == "export-1"), None)
        if export_task and export_task.get("status") == "finished":
            files = export_task.get("result", {}).get("files", [])
            if files:
                return files[0].get("url"), None

    return None, {
        "error": "CloudConvert failed",
        "details": "CloudConvert conversion timed out",
    }


@app.route("/api/convert", methods=["POST"])
def convert_file():
    temp_path = None
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

        with tempfile.NamedTemporaryFile(delete=False, suffix="_" + filename) as temp_file:
            uploaded_file.save(temp_file)
            temp_path = temp_file.name

        download_url, error = create_cloudconvert_download_url(temp_path)
        if error:
            return jsonify(error), 500

        return jsonify({"download_url": download_url}), 200

    except requests.RequestException as exc:
        print("ERROR:", str(exc))
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:
        print("ERROR:", str(exc))
        return jsonify({"error": str(exc)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
