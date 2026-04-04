from flask import Flask, request, send_file, jsonify
import requests
import os
import tempfile

app = Flask(__name__)

API_SECRET = os.getenv("CONVERT_API_SECRET")

@app.route("/api/convert", methods=["POST"])
def convert_file():
    try:
        file = request.files.get("file")

        if not file:
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
                data={"Secret": API_SECRET}
            )

        print("ConvertAPI raw response:", response.text)

        data = response.json()

        # Check error
        if "Files" not in data:
            return jsonify({"error": data}), 500

        pdf_url = data["Files"][0]["Url"]

        # Download PDF
        pdf_response = requests.get(pdf_url)

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