"""
SmartConvert - Full File Tools Platform (like iLovePDF / SmallPDF)
Multi-tool file conversion, PDF editing, image processing, and more.
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
import io
import os
import shutil
import requests
import time
import logging
from pathlib import Path
from datetime import datetime
import uuid

# Initialize Flask app first
app = Flask(__name__)

# Configure logging BEFORE trying to use it
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Try to import optional dependencies
try:
    from PyPDF2 import PdfMerger, PdfReader, PdfWriter
    PDF_TOOLS_AVAILABLE = True
    logger.info("[BOOT] PyPDF2 successfully loaded - PDF tools available")
except ImportError:
    PDF_TOOLS_AVAILABLE = False
    logger.warning("[BOOT] PyPDF2 not installed - PDF tools will not be available")

try:
    from PIL import Image, ImageDraw, ImageFont
    IMAGE_TOOLS_AVAILABLE = True
    logger.info("[BOOT] Pillow successfully loaded - Image tools available")
except ImportError:
    IMAGE_TOOLS_AVAILABLE = False
    logger.warning("[BOOT] Pillow not installed - Image tools will not be available")

try:
    import fitz
    FITZ_AVAILABLE = True
    logger.info("[BOOT] PyMuPDF successfully loaded - PDF rendering available")
except ImportError:
    FITZ_AVAILABLE = False
    logger.warning("[BOOT] PyMuPDF not installed - PDF rendering unavailable")

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'outputs')
API_KEY = os.environ.get("CLOUDCONVERT_API_KEY")

# Supported input formats (detected from uploaded file)
SUPPORTED_INPUT_FORMATS = {'docx', 'doc', 'odt', 'pptx', 'ppt', 'odp', 'xlsx', 'xls', 'ods', 'pdf'}

# Create folders if they don't exist
Path(UPLOAD_FOLDER).mkdir(exist_ok=True)
Path(OUTPUT_FOLDER).mkdir(exist_ok=True)

# Enable CORS (so frontend can make requests)
CORS(app)

# Add request logging
@app.before_request
def log_request():
    """Log all incoming requests"""
    logger.info(f"[REQUEST] {request.method} {request.path} from {request.remote_addr}")

# ============================================
# Helper Functions
# ============================================

def get_file_extension(filename):
    """Extract file extension from filename"""
    return os.path.splitext(filename)[1].lstrip('.').lower()

def generate_unique_filename(original_filename, suffix=''):
    """Generate a unique filename to avoid conflicts"""
    base_name = os.path.splitext(secure_filename(original_filename))[0]
    extension = get_file_extension(original_filename)
    unique_id = str(uuid.uuid4())[:8]
    
    if suffix:
        return f"{base_name}_{suffix}_{unique_id}.{extension}"
    return f"{base_name}_{unique_id}.{extension}"

def convert_docx_to_pdf(file_path):
    if not API_KEY:
        raise ValueError('CLOUDCONVERT_API_KEY is not configured')

    headers = {
        'Authorization': f'Bearer {API_KEY}',
        'Content-Type': 'application/json'
    }

    job = {
        'tasks': {
            'import-file': {'operation': 'import/upload'},
            'convert-file': {
                'operation': 'convert',
                'input': 'import-file',
                'output_format': 'pdf'
            },
            'export-file': {'operation': 'export/url', 'input': 'convert-file'}
        }
    }

    res = requests.post('https://api.cloudconvert.com/v2/jobs', json=job, headers=headers)
    res.raise_for_status()
    res_data = res.json()

    upload_task = next((t for t in res_data['data']['tasks'] if t['name'] == 'import-file'), None)
    if not upload_task:
        raise ValueError('CloudConvert upload task was not created')

    upload_url = upload_task['result']['form']['url']
    params = upload_task['result']['form']['parameters']

    with open(file_path, 'rb') as file_handle:
        upload_response = requests.post(upload_url, data=params, files={'file': file_handle})
        upload_response.raise_for_status()

    job_id = res_data['data']['id']

    for _ in range(12):
        time.sleep(5)
        result = requests.get(f'https://api.cloudconvert.com/v2/jobs/{job_id}', headers=headers)
        result.raise_for_status()
        result_data = result.json()

        export_task = next((t for t in result_data['data']['tasks'] if t['name'] == 'export-file'), None)
        if export_task and export_task.get('status') == 'finished':
            files = export_task.get('result', {}).get('files', [])
            if files:
                return files[0]['url']

        failed_task = next((t for t in result_data['data']['tasks'] if t.get('status') == 'error'), None)
        if failed_task:
            raise RuntimeError(f"CloudConvert task failed: {failed_task.get('message', 'Unknown error')}")

    raise TimeoutError('CloudConvert conversion timed out')

def get_available_tools():
    """Return list of available tools based on installed dependencies"""
    tools = [
        {
            'id': 'convert',
            'name': 'Convert File',
            'description': 'Convert documents between formats (DOCX, PDF, TXT, etc.)',
            'icon': '🔄',
            'available': True,
            'formats': list(SUPPORTED_INPUT_FORMATS)
        }
    ]
    
    if PDF_TOOLS_AVAILABLE:
        tools.extend([
            {
                'id': 'merge-pdf',
                'name': 'Merge PDF',
                'description': 'Combine multiple PDF files into one document',
                'icon': '📎',
                'available': True
            },
            {
                'id': 'split-pdf',
                'name': 'Split PDF',
                'description': 'Extract specific pages or split PDF into separate files',
                'icon': '✂️',
                'available': True
            },
            {
                'id': 'compress-pdf',
                'name': 'Compress PDF',
                'description': 'Reduce PDF file size while maintaining quality',
                'icon': '📦',
                'available': True
            },
            {
                'id': 'edit-pdf',
                'name': 'Edit PDF',
                'description': 'Replace text and add an image/logo to PDF pages',
                'icon': '✏️',
                'available': FITZ_AVAILABLE
            }
        ])
    
    if IMAGE_TOOLS_AVAILABLE:
        tools.extend([
            {
                'id': 'image-convert',
                'name': 'Image to PDF',
                'description': 'Convert images (JPG, PNG, GIF) to PDF documents',
                'icon': '🖼️',
                'available': True
            }
        ])
    
    return tools

# ============================================
# Document Conversion Fallbacks
# ============================================

def _unsupported_document_conversion(input_format, output_format):
    """Return a safe error response for unsupported document conversions on Render."""
    if input_format == 'docx' and output_format == 'pdf':
        return False, {'error': 'DOCX to PDF conversion is not supported on this server'}

    return False, {'error': 'Document conversion is not supported on this server'}

# ============================================
# PDF Functions (if PyPDF2 is available)
# ============================================

def _merge_pdfs(pdf_files, output_path):
    """Merge multiple PDFs using PyPDF2"""
    if not PDF_TOOLS_AVAILABLE:
        return False, "PDF tools not available"
    
    try:
        merger = PdfMerger()
        
        for pdf_file in pdf_files:
            merger.append(pdf_file)
        
        merger.write(output_path)
        merger.close()
        
        logger.info(f"[PDF MERGE] Merged {len(pdf_files)} PDFs to: {output_path}")
        return True, output_path
        
    except Exception as e:
        logger.error(f"[PDF MERGE ERROR] {str(e)}")
        return False, str(e)

def _parse_split_pages(pages_text, total_pages):
    """Parse page ranges like 1,2,4-6 into zero-based page indexes."""
    if not pages_text:
        return None, "Pages input is required"

    selected_pages = []
    seen_pages = set()

    for raw_part in pages_text.split(','):
        part = raw_part.strip()
        if not part:
            continue

        if '-' in part:
            start_text, end_text = [item.strip() for item in part.split('-', 1)]
            if not start_text.isdigit() or not end_text.isdigit():
                return None, f"Invalid page range: {part}"

            start_page = int(start_text)
            end_page = int(end_text)
            if start_page > end_page:
                return None, f"Invalid page range: {part}"

            for page_number in range(start_page, end_page + 1):
                if page_number < 1 or page_number > total_pages:
                    return None, f"Page {page_number} is outside the document range (1-{total_pages})"
                if page_number not in seen_pages:
                    seen_pages.add(page_number)
                    selected_pages.append(page_number - 1)
        else:
            if not part.isdigit():
                return None, f"Invalid page number: {part}"

            page_number = int(part)
            if page_number < 1 or page_number > total_pages:
                return None, f"Page {page_number} is outside the document range (1-{total_pages})"
            if page_number not in seen_pages:
                seen_pages.add(page_number)
                selected_pages.append(page_number - 1)

    if not selected_pages:
        return None, "No valid pages selected"

    return selected_pages, None

# ============================================
# Image Functions (if Pillow is available)
# ============================================

def _convert_image_format(input_path, output_format):
    """Convert image between formats using Pillow"""
    if not IMAGE_TOOLS_AVAILABLE:
        return False, "Image tools not available"
    
    try:
        # Open image
        image = Image.open(input_path)
        
        # Handle JPEG conversion (remove alpha channel if present)
        if output_format.lower() == 'jpg':
            if image.mode in ('RGBA', 'LA', 'P'):
                # Create white background
                background = Image.new('RGB', image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                image = background
        
        # Convert color mode if needed
        if output_format.lower() in ['jpg', 'jpeg'] and image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Save in new format
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        output_file = os.path.join(OUTPUT_FOLDER, f"{base_name}.{output_format}")
        image.save(output_file, quality=95)
        
        logger.info(f"[IMAGE CONVERT] Converted to: {output_file}")
        return True, output_file
        
    except Exception as e:
        logger.error(f"[IMAGE CONVERT ERROR] {str(e)}")
        return False, str(e)

def _image_to_pdf_file(image_path):
    """Convert image to PDF using Pillow"""
    if not IMAGE_TOOLS_AVAILABLE:
        return False, "Image tools not available"
    
    try:
        # Open image
        image = Image.open(image_path)
        
        # Convert RGBA to RGB (PDF doesn't support transparency)
        if image.mode == 'RGBA':
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])
            image = background
        elif image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Save as PDF
        base_name = os.path.splitext(os.path.basename(image_path))[0]
        output_file = os.path.join(OUTPUT_FOLDER, f"{base_name}.pdf")
        image.save(output_file, 'PDF')
        
        logger.info(f"[IMAGE TO PDF] Created PDF: {output_file}")
        return True, output_file
        
    except Exception as e:
        logger.error(f"[IMAGE TO PDF ERROR] {str(e)}")
        return False, str(e)

def _compress_pdf_file(input_path, output_path, target_size_kb):
    """Best-effort PDF compression with a user-defined target size."""
    if not PDF_TOOLS_AVAILABLE:
        return False, "PDF tools not available", None, False

    try:
        target_size_kb = int(target_size_kb)
    except (TypeError, ValueError):
        return False, "Invalid target size", None, False

    if target_size_kb < 50 or target_size_kb > 1024:
        return False, "Target size must be between 50 KB and 1024 KB", None, False

    target_bytes = target_size_kb * 1024
    temp_output = f"{output_path}.tmp"
    working_input = input_path
    best_size = os.path.getsize(input_path)
    target_met = best_size <= target_bytes

    def _save_rasterized_pdf(source_path, destination_path, dpi):
        if not (FITZ_AVAILABLE and IMAGE_TOOLS_AVAILABLE):
            return False

        doc = fitz.open(source_path)
        rendered_images = []

        try:
            for page in doc:
                pixmap = page.get_pixmap(matrix=fitz.Matrix(dpi / 72.0, dpi / 72.0), alpha=False)
                image = Image.open(io.BytesIO(pixmap.tobytes("png")))
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                rendered_images.append(image)

            if not rendered_images:
                return False

            rendered_images[0].save(
                destination_path,
                "PDF",
                save_all=True,
                append_images=rendered_images[1:],
                resolution=dpi
            )
            return True
        finally:
            doc.close()

    # Rasterize pages at progressively lower DPI if the target is still not reached.
    if FITZ_AVAILABLE and IMAGE_TOOLS_AVAILABLE:
        dpi_candidates = [150, 120, 96, 72, 60, 48, 36, 24]

        for dpi in dpi_candidates:
            try:
                if not _save_rasterized_pdf(working_input, temp_output, dpi):
                    continue

                current_size = os.path.getsize(temp_output)
                logger.info(f"[PDF COMPRESS] Rasterized at {dpi} DPI: {current_size} bytes")

                if current_size < best_size:
                    best_size = current_size

                if current_size <= target_bytes:
                    os.replace(temp_output, output_path)
                    return True, output_path, current_size, True

                working_input = temp_output
            except Exception as e:
                logger.warning(f"[PDF COMPRESS] Raster compression failed at {dpi} DPI: {str(e)}")

    if os.path.exists(temp_output):
        os.replace(temp_output, output_path)
    else:
        shutil.copyfile(input_path, output_path)

    final_size = os.path.getsize(output_path)
    return True, output_path, final_size, final_size <= target_bytes

def _edit_pdf_file(input_path, output_path, find_text=None, replace_text=None, image_path=None,
                   image_page='all', image_x=40, image_y=40, image_width=160):
    """Edit PDF content by replacing text and/or adding an image."""
    if not FITZ_AVAILABLE:
        return False, "PDF edit tools are not available", None

    find_text = (find_text or '').strip()
    replace_text = (replace_text or '').strip()

    if not ((find_text and replace_text) or image_path):
        return False, "Provide text replacement and/or an image to insert", None

    try:
        image_x = float(image_x)
        image_y = float(image_y)
        image_width = float(image_width)
    except (TypeError, ValueError):
        return False, "Image position and width must be numbers", None

    if image_width <= 0:
        return False, "Image width must be greater than 0", None

    replacements_count = 0
    images_added_count = 0

    doc = fitz.open(input_path)
    try:
        # Replace text occurrences on every page.
        if find_text and replace_text:
            for page in doc:
                text_rects = page.search_for(find_text)
                if not text_rects:
                    continue

                for rect in text_rects:
                    page.add_redact_annot(rect, fill=(1, 1, 1))

                page.apply_redactions()

                for rect in text_rects:
                    # Keep replacement text readable and approximately aligned.
                    font_size = max(8, min(28, rect.height * 0.85))
                    page.insert_text(
                        (rect.x0, rect.y1 - 2),
                        replace_text,
                        fontsize=font_size,
                        color=(0, 0, 0)
                    )

                replacements_count += len(text_rects)

        # Add image on target page(s).
        if image_path:
            image_height = image_width
            if IMAGE_TOOLS_AVAILABLE:
                try:
                    with Image.open(image_path) as image:
                        if image.width > 0:
                            image_height = image_width * (image.height / image.width)
                except Exception as image_error:
                    logger.warning(f"[PDF EDIT] Could not read image dimensions: {str(image_error)}")

            target_pages = []
            if str(image_page).lower() == 'all':
                target_pages = list(range(len(doc)))
            else:
                try:
                    page_number = int(image_page)
                except ValueError:
                    return False, "Image page must be 'all' or a valid page number", None

                if page_number < 1 or page_number > len(doc):
                    return False, f"Image page must be between 1 and {len(doc)}", None

                target_pages = [page_number - 1]

            for page_index in target_pages:
                page = doc[page_index]
                image_rect = fitz.Rect(image_x, image_y, image_x + image_width, image_y + image_height)
                page.insert_image(image_rect, filename=image_path)
                images_added_count += 1

        doc.save(output_path)
    finally:
        doc.close()

    return True, output_path, {
        'replacements_count': replacements_count,
        'images_added_count': images_added_count
    }

# ============================================
# Flask Routes
# ============================================

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    }), 200

@app.route('/api/tools', methods=['GET'])
def get_tools():
    """Get list of available tools"""
    logger.info(f"[DEBUG] /api/tools route hit!")
    return jsonify({
        'status': 'success',
        'tools': get_available_tools()
    }), 200

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload a file for conversion"""
    
    try:
        # Check if file is present
        if 'file' not in request.files:
            logger.warning(f"[UPLOAD FAILED] No file provided in request")
            return jsonify({
                'status': 'error',
                'message': 'No file provided'
            }), 400
        
        file = request.files['file']
        
        # Check if file is empty
        if file.filename == '':
            logger.warning(f"[UPLOAD FAILED] No file selected")
            return jsonify({
                'status': 'error',
                'message': 'No file selected'
            }), 400
        
        # Get file extension
        original_filename = secure_filename(file.filename)
        file_extension = get_file_extension(original_filename)
        
        # Check if format is supported
        if file_extension not in SUPPORTED_INPUT_FORMATS:
            logger.warning(f"[UPLOAD BLOCKED] Unsupported format: {file_extension}")
            supported = ', '.join(sorted(SUPPORTED_INPUT_FORMATS))
            return jsonify({
                'status': 'error',
                'message': f'Format .{file_extension} not supported. Supported formats: {supported}'
            }), 400
        
        # Generate unique filename to avoid collisions
        unique_id = str(uuid.uuid4())[:8]
        base_name = os.path.splitext(original_filename)[0]
        unique_filename = f'{base_name}_{unique_id}.{file_extension}'
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
        
        # Save the file
        file.save(file_path)
        
        # Verify file was saved successfully
        if not os.path.exists(file_path):
            logger.error(f"[UPLOAD FAILED] File was not saved to disk")
            return jsonify({
                'status': 'error',
                'message': 'File save failed'
            }), 500
        
        file_size = os.path.getsize(file_path)
        
        # Check if file is empty
        if file_size == 0:
            logger.warning(f"[UPLOAD FAILED] Uploaded file is empty")
            os.remove(file_path)
            return jsonify({
                'status': 'error',
                'message': 'Uploaded file is empty'
            }), 400
        
        logger.info(f"[UPLOAD SUCCESS] File: {unique_filename}, Size: {file_size} bytes, Format: {file_extension.upper()}")
        
        return jsonify({
            'status': 'success',
            'message': f'File uploaded successfully',
            'filename': unique_filename,
            'original_filename': original_filename,
            'file_size': file_size,
            'format': file_extension
        }), 200
    
    except Exception as e:
        logger.error(f"[UPLOAD ERROR] {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'Upload error: {str(e)}'
        }), 500

@app.route('/api/convert', methods=['POST'])
def convert_file():
    """Convert an uploaded file to the requested format"""
    
    try:
        # Get data
        data = request.get_json()
        logger.info(f"[REQUEST] Conversion request received")
        
        if not data:
            logger.warning(f"[REQUEST] No JSON data provided")
            return jsonify({
                'status': 'error',
                'message': 'No JSON data provided'
            }), 400
        
        filename = data.get('filename', '')
        output_format = data.get('output_format', '').lower()
        
        logger.info(f"[PARAMS] Filename: {filename}, Target format: {output_format}")
        
        # Validate inputs
        if not filename or not output_format:
            logger.warning(f"[VALIDATION] Missing filename or output_format")
            return jsonify({
                'status': 'error',
                'message': 'Missing filename or output_format'
            }), 400
        
        # Get input file path
        input_path = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
        
        if not os.path.exists(input_path):
            logger.warning(f"[VALIDATION] Uploaded file not found: {filename}")
            return jsonify({
                'status': 'error',
                'message': 'Uploaded file not found'
            }), 404
        
        # Detect input format from filename
        input_format = get_file_extension(filename)
        logger.info(f"[FORMAT DETECTION] Detected input format: {input_format}")
        
        # Check if input format is supported
        if input_format not in SUPPORTED_INPUT_FORMATS:
            logger.warning(f"[VALIDATION] Unsupported input format: {input_format}")
            supported = ', '.join(SUPPORTED_INPUT_FORMATS)
            return jsonify({
                'status': 'error',
                'message': f'Input format {input_format.upper()} is not supported. Supported: {supported}'
            }), 400
        
        logger.info(f"[CONVERSION STARTING] {input_format.upper()} -> {output_format.upper()}")

        if input_format == 'docx' and output_format == 'pdf':
            try:
                download_url = convert_docx_to_pdf(input_path)
                logger.info(f"[CONVERSION SUCCESS] CloudConvert produced PDF for {filename}")
                return jsonify({
                    'status': 'success',
                    'message': 'File converted to PDF successfully',
                    'download_url': download_url
                }), 200
            except Exception as e:
                logger.error(f"[CLOUDCONVERT ERROR] {str(e)}")
                return jsonify({
                    'status': 'error',
                    'message': str(e)
                }), 400

        return jsonify({
            'status': 'error',
            'message': 'Only DOCX to PDF conversion is supported on this server'
        }), 400
    
    except Exception as e:
        logger.error(f"[CONVERSION ERROR] {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'Conversion failed: {str(e)}'
        }), 500

@app.route('/api/download/<filename>', methods=['GET'])
def download_file(filename):
    """Download converted file"""
    try:
        filename = secure_filename(filename)
        file_path = os.path.join(OUTPUT_FOLDER, filename)
        
        if not os.path.exists(file_path):
            logger.warning(f"[DOWNLOAD] File not found: {filename}")
            return jsonify({
                'status': 'error',
                'message': 'File not found'
            }), 404
        
        logger.info(f"[DOWNLOAD] Serving file: {filename}")
        return send_from_directory(OUTPUT_FOLDER, filename, as_attachment=True)
    
    except Exception as e:
        logger.error(f"[DOWNLOAD ERROR] {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'Download error: {str(e)}'
        }), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    """Get conversion history"""
    try:
        history_file = os.path.join(os.path.dirname(__file__), 'routes', 'history.py')
        if os.path.exists(history_file):
            logger.info(f"[HISTORY] Retrieving history")
            return jsonify({
                'status': 'success',
                'message': 'History retrieved',
                'files': []
            }), 200
        
        return jsonify({
            'status': 'success',
            'message': 'No history available',
            'files': []
        }), 200
    
    except Exception as e:
        logger.error(f"[HISTORY ERROR] {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'History error: {str(e)}'
        }), 500

# PDF Routes (if available)
if PDF_TOOLS_AVAILABLE:
    @app.route('/api/pdf-merge', methods=['POST'])
    def pdf_merge_endpoint():
        """Merge multiple PDF files"""
        temp_files = []
        
        try:
            logger.info(f"[PDF MERGE] Request received")
            
            if 'files' not in request.files:
                return jsonify({
                    'status': 'error',
                    'message': 'No files provided'
                }), 400
            
            files = request.files.getlist('files')
            
            if not files or len(files) < 2:
                return jsonify({
                    'status': 'error',
                    'message': 'At least 2 PDF files required'
                }), 400
            
            # Save and validate files
            pdf_paths = []
            for file in files:
                if not file.filename.lower().endswith('.pdf'):
                    return jsonify({
                        'status': 'error',
                        'message': f'Invalid file: {file.filename}. Only PDF files allowed'
                    }), 400
                
                unique_id = str(uuid.uuid4())[:8]
                saved_filename = f"pdf_{unique_id}_{secure_filename(file.filename)}"
                file_path = os.path.join(UPLOAD_FOLDER, saved_filename)
                file.save(file_path)
                temp_files.append(file_path)
                pdf_paths.append(file_path)
            
            # Merge PDFs
            base_name = os.path.splitext(files[0].filename)[0]
            output_filename = f"{base_name}_merged_{str(uuid.uuid4())[:8]}.pdf"
            output_path = os.path.join(OUTPUT_FOLDER, output_filename)
            
            success, result = _merge_pdfs(pdf_paths, output_path)
            
            if not success:
                return jsonify({
                    'status': 'error',
                    'message': result
                }), 400
            
            file_size = os.path.getsize(result)
            download_url = f'/api/download/{output_filename}'
            
            logger.info(f"[PDF MERGE SUCCESS] Created {output_filename} ({file_size} bytes)")
            
            return jsonify({
                'status': 'success',
                'message': f'Merged {len(files)} PDFs successfully',
                'download_url': download_url,
                'output_filename': output_filename,
                'file_size': file_size
            }), 200
        
        except Exception as e:
            logger.error(f"[PDF MERGE ERROR] {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Merge failed: {str(e)}'
            }), 500
        
        finally:
            # Clean up uploaded files
            for temp_file in temp_files:
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                        logger.info(f"[CLEANUP] Removed: {os.path.basename(temp_file)}")
                except Exception as e:
                    logger.warning(f"[CLEANUP WARNING] Could not remove: {str(e)}")

    @app.route('/api/split-pdf', methods=['POST'])
    def split_pdf_endpoint():
        """Extract selected pages from one PDF into a new PDF"""
        temp_file = None

        try:
            logger.info("[PDF SPLIT] Request received")

            if 'file' not in request.files:
                return jsonify({
                    'status': 'error',
                    'message': 'No file provided'
                }), 400

            file = request.files['file']
            if not file or file.filename == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No PDF file selected'
                }), 400

            if not file.filename.lower().endswith('.pdf'):
                return jsonify({
                    'status': 'error',
                    'message': 'Only PDF files are allowed'
                }), 400

            pages_text = request.form.get('pages', '').strip()
            if not pages_text:
                return jsonify({
                    'status': 'error',
                    'message': 'Pages are required'
                }), 400

            original_filename = secure_filename(file.filename)
            unique_id = str(uuid.uuid4())[:8]
            unique_filename = f"split_{unique_id}_{original_filename}"
            file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
            file.save(file_path)
            temp_file = file_path

            if not os.path.exists(file_path):
                return jsonify({
                    'status': 'error',
                    'message': 'File save failed'
                }), 500

            reader = PdfReader(file_path)
            total_pages = len(reader.pages)
            selected_pages, parse_error = _parse_split_pages(pages_text, total_pages)

            if parse_error:
                return jsonify({
                    'status': 'error',
                    'message': parse_error
                }), 400

            writer = PdfWriter()
            for page_index in selected_pages:
                writer.add_page(reader.pages[page_index])

            output_filename = f"split_{unique_id}_{os.path.splitext(original_filename)[0]}.pdf"
            output_path = os.path.join(OUTPUT_FOLDER, output_filename)

            with open(output_path, 'wb') as output_file:
                writer.write(output_file)

            if not os.path.exists(output_path):
                return jsonify({
                    'status': 'error',
                    'message': 'Split output file was not created'
                }), 500

            output_size = os.path.getsize(output_path)
            download_url = f'/api/download/{output_filename}'

            return jsonify({
                'status': 'success',
                'message': f'Split PDF successfully using pages: {pages_text}',
                'download_url': download_url,
                'output_filename': output_filename,
                'file_size': output_size,
                'page_count': len(selected_pages),
                'total_pages': total_pages,
                'selected_pages': [page + 1 for page in selected_pages]
            }), 200

        except Exception as e:
            logger.error(f"[PDF SPLIT ERROR] {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Split failed: {str(e)}'
            }), 500

        finally:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                    logger.info(f"[CLEANUP] Removed temp file: {os.path.basename(temp_file)}")
                except Exception as e:
                    logger.warning(f"[CLEANUP WARNING] Could not remove temp file: {str(e)}")

    @app.route('/api/compress-pdf', methods=['POST'])
    def compress_pdf_endpoint():
        """Compress a PDF to a target size"""
        temp_file = None

        try:
            logger.info("[PDF COMPRESS] Request received")

            if 'file' not in request.files:
                return jsonify({
                    'status': 'error',
                    'message': 'No file provided'
                }), 400

            file = request.files['file']
            if not file or file.filename == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No PDF file selected'
                }), 400

            if not file.filename.lower().endswith('.pdf'):
                return jsonify({
                    'status': 'error',
                    'message': 'Only PDF files are allowed'
                }), 400

            target_size_raw = request.form.get('target_size_kb', '250')
            try:
                target_size_kb = int(target_size_raw)
            except ValueError:
                return jsonify({
                    'status': 'error',
                    'message': 'Target size must be a number in KB'
                }), 400

            if target_size_kb < 50 or target_size_kb > 1024:
                return jsonify({
                    'status': 'error',
                    'message': 'Target size must be between 50 KB and 1024 KB'
                }), 400

            original_filename = secure_filename(file.filename)
            unique_id = str(uuid.uuid4())[:8]
            unique_filename = f"pdf_{unique_id}_{original_filename}"
            file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
            file.save(file_path)
            temp_file = file_path

            if not os.path.exists(file_path):
                return jsonify({
                    'status': 'error',
                    'message': 'File save failed'
                }), 500

            original_size = os.path.getsize(file_path)
            output_filename = f"compressed_{unique_id}_{os.path.splitext(original_filename)[0]}.pdf"
            output_path = os.path.join(OUTPUT_FOLDER, output_filename)

            success, result, compressed_size, target_met = _compress_pdf_file(file_path, output_path, target_size_kb)

            if not success:
                return jsonify({
                    'status': 'error',
                    'message': result
                }), 400

            reduction_percent = round(((original_size - compressed_size) / original_size) * 100, 2) if original_size else 0
            download_url = f'/api/download/{output_filename}'

            message = 'PDF compressed successfully'
            if not target_met:
                message = f'PDF compressed successfully, but the selected target size was not fully reached.'

            return jsonify({
                'status': 'success',
                'message': message,
                'download_url': download_url,
                'output_filename': output_filename,
                'original_size': original_size,
                'compressed_size': compressed_size,
                'reduction_percent': reduction_percent,
                'target_size_kb': target_size_kb,
                'target_met': target_met
            }), 200

        except Exception as e:
            logger.error(f"[PDF COMPRESS ERROR] {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Compression failed: {str(e)}'
            }), 500

        finally:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                    logger.info(f"[CLEANUP] Removed temp file: {os.path.basename(temp_file)}")
                except Exception as e:
                    logger.warning(f"[CLEANUP WARNING] Could not remove temp file: {str(e)}")

    @app.route('/api/edit-pdf', methods=['POST'])
    def edit_pdf_endpoint():
        """Edit a PDF by replacing text and/or adding an image."""
        temp_pdf = None
        temp_image = None

        try:
            logger.info("[PDF EDIT] Request received")

            if not FITZ_AVAILABLE:
                return jsonify({
                    'status': 'error',
                    'message': 'PDF edit tools are not available on the server'
                }), 503

            if 'file' not in request.files:
                return jsonify({
                    'status': 'error',
                    'message': 'No PDF file provided'
                }), 400

            file = request.files['file']
            if not file or file.filename == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No PDF file selected'
                }), 400

            if not file.filename.lower().endswith('.pdf'):
                return jsonify({
                    'status': 'error',
                    'message': 'Only PDF files are allowed'
                }), 400

            find_text = request.form.get('find_text', '').strip()
            replace_text = request.form.get('replace_text', '').strip()

            has_text_edit = bool(find_text or replace_text)
            if has_text_edit and not (find_text and replace_text):
                return jsonify({
                    'status': 'error',
                    'message': 'Both Find text and Replace with text are required for text editing'
                }), 400

            image_file = request.files.get('image')
            has_image = image_file is not None and image_file.filename != ''

            if not has_text_edit and not has_image:
                return jsonify({
                    'status': 'error',
                    'message': 'Provide text replacement and/or an image to edit the PDF'
                }), 400

            original_filename = secure_filename(file.filename)
            unique_id = str(uuid.uuid4())[:8]
            input_filename = f"edit_{unique_id}_{original_filename}"
            input_path = os.path.join(UPLOAD_FOLDER, input_filename)
            file.save(input_path)
            temp_pdf = input_path

            if has_image:
                image_name = secure_filename(image_file.filename)
                if not image_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp')):
                    return jsonify({
                        'status': 'error',
                        'message': 'Image must be PNG, JPG, JPEG, GIF, BMP, or WEBP'
                    }), 400

                image_filename = f"editimg_{unique_id}_{image_name}"
                image_path = os.path.join(UPLOAD_FOLDER, image_filename)
                image_file.save(image_path)
                temp_image = image_path
            else:
                image_path = None

            image_page = request.form.get('image_page', 'all').strip() or 'all'
            image_x = request.form.get('image_x', '40').strip() or '40'
            image_y = request.form.get('image_y', '40').strip() or '40'
            image_width = request.form.get('image_width', '160').strip() or '160'

            output_filename = f"edited_{unique_id}_{os.path.splitext(original_filename)[0]}.pdf"
            output_path = os.path.join(OUTPUT_FOLDER, output_filename)

            success, result, details = _edit_pdf_file(
                input_path,
                output_path,
                find_text=find_text,
                replace_text=replace_text,
                image_path=image_path,
                image_page=image_page,
                image_x=image_x,
                image_y=image_y,
                image_width=image_width
            )

            if not success:
                return jsonify({
                    'status': 'error',
                    'message': result
                }), 400

            file_size = os.path.getsize(result)
            download_url = f'/api/download/{output_filename}'

            return jsonify({
                'status': 'success',
                'message': 'PDF edited successfully',
                'download_url': download_url,
                'output_filename': output_filename,
                'file_size': file_size,
                'replacements_count': details.get('replacements_count', 0),
                'images_added_count': details.get('images_added_count', 0)
            }), 200

        except Exception as e:
            logger.error(f"[PDF EDIT ERROR] {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Edit failed: {str(e)}'
            }), 500

        finally:
            for temp_file in [temp_pdf, temp_image]:
                if temp_file and os.path.exists(temp_file):
                    try:
                        os.remove(temp_file)
                        logger.info(f"[CLEANUP] Removed temp file: {os.path.basename(temp_file)}")
                    except Exception as e:
                        logger.warning(f"[CLEANUP WARNING] Could not remove temp file: {str(e)}")

# Image Routes (if available)
if IMAGE_TOOLS_AVAILABLE:
    @app.route('/api/image-convert', methods=['POST'])
    def image_convert_endpoint():
        """Convert image between formats"""
        
        temp_file = None
        
        try:
            logger.info(f"[IMAGE CONVERT] Request received")
            
            if 'file' not in request.files or 'output_format' not in request.form:
                return jsonify({
                    'status': 'error',
                    'message': 'Missing file or output_format'
                }), 400
            
            file = request.files['file']
            output_format = request.form['output_format'].lower()
            
            if not file or file.filename == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No image file selected'
                }), 400
            
            # Validate output format
            valid_formats = ['png', 'jpg', 'jpeg', 'gif', 'bmp']
            if output_format not in valid_formats:
                return jsonify({
                    'status': 'error',
                    'message': f'Unsupported format: {output_format}. Supported: {", ".join(valid_formats)}'
                }), 400
            
            logger.info(f"[IMAGE CONVERT] Input: {file.filename}, Output: {output_format}")
            
            # Save file with unique name
            original_filename = secure_filename(file.filename)
            unique_id = str(uuid.uuid4())[:8]
            unique_filename = f"img_{unique_id}_{original_filename}"
            file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
            file.save(file_path)
            temp_file = file_path
            
            # Verify file was saved
            if not os.path.exists(file_path):
                logger.error(f"[IMAGE CONVERT] File save failed")
                return jsonify({
                    'status': 'error',
                    'message': 'File save failed'
                }), 500
            
            # Convert image
            success, result = _convert_image_format(file_path, output_format)
            
            if not success:
                logger.error(f"[IMAGE CONVERT FAILED] {result}")
                return jsonify({
                    'status': 'error',
                    'message': result
                }), 400
            
            output_filename = os.path.basename(result)
            file_size = os.path.getsize(result)
            download_url = f'/api/download/{output_filename}'
            
            logger.info(f"[IMAGE CONVERT SUCCESS] Created {output_filename} ({file_size} bytes)")
            
            return jsonify({
                'status': 'success',
                'message': f'Image converted to {output_format.upper()} successfully',
                'download_url': download_url,
                'output_filename': output_filename,
                'format': output_format.upper()
            }), 200
        
        except Exception as e:
            logger.error(f"[IMAGE CONVERT ERROR] {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Conversion failed: {str(e)}'
            }), 500
        
        finally:
            # Clean up temporary file
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                    logger.info(f"[CLEANUP] Removed temp file: {os.path.basename(temp_file)}")
                except Exception as e:
                    logger.warning(f"[CLEANUP WARNING] Could not remove temp file: {str(e)}")

    @app.route('/api/image-to-pdf', methods=['POST'])
    def image_to_pdf_endpoint():
        """Convert image to PDF"""
        
        temp_file = None
        
        try:
            logger.info(f"[IMAGE TO PDF] Request received")
            
            if 'file' not in request.files:
                return jsonify({
                    'status': 'error',
                    'message': 'No image file provided'
                }), 400
            
            file = request.files['file']
            
            if not file or file.filename == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No image file selected'
                }), 400
            
            logger.info(f"[IMAGE TO PDF] Input file: {file.filename}")
            
            # Save file with unique name
            original_filename = secure_filename(file.filename)
            unique_id = str(uuid.uuid4())[:8]
            unique_filename = f"img_{unique_id}_{original_filename}"
            file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
            file.save(file_path)
            temp_file = file_path
            
            # Verify file was saved
            if not os.path.exists(file_path):
                logger.error(f"[IMAGE TO PDF] File save failed")
                return jsonify({
                    'status': 'error',
                    'message': 'File save failed'
                }), 500
            
            # Convert to PDF
            success, result = _image_to_pdf_file(file_path)
            
            if not success:
                logger.error(f"[IMAGE TO PDF FAILED] {result}")
                return jsonify({
                    'status': 'error',
                    'message': result
                }), 400
            
            output_filename = os.path.basename(result)
            file_size = os.path.getsize(result)
            download_url = f'/api/download/{output_filename}'
            
            logger.info(f"[IMAGE TO PDF SUCCESS] Created PDF ({file_size} bytes)")
            
            return jsonify({
                'status': 'success',
                'message': 'Image converted to PDF successfully',
                'download_url': download_url,
                'output_filename': output_filename,
                'file_size': file_size
            }), 200
        
        except Exception as e:
            logger.error(f"[IMAGE TO PDF ERROR] {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Conversion failed: {str(e)}'
            }), 500
        
        finally:
            # Clean up temporary file
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                    logger.info(f"[CLEANUP] Removed temp file: {os.path.basename(temp_file)}")
                except Exception as e:
                    logger.warning(f"[CLEANUP WARNING] Could not remove temp file: {str(e)}")

# Frontend Routes
@app.route('/', methods=['GET'])
def index():
    """Serve the frontend index.html"""
    return send_from_directory(os.path.join(os.path.dirname(__file__), '..', 'frontend'), 'index.html')

@app.route('/style.css')
def serve_style():
    """Serve CSS file"""
    frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
    return send_from_directory(frontend_dir, 'style.css')

@app.route('/script.js')
def serve_script():
    """Serve JavaScript file"""
    frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
    return send_from_directory(frontend_dir, 'script.js')

# ============================================
# Error Handlers
# ============================================

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'status': 'error',
        'message': 'Not found'
    }), 404

@app.errorhandler(500)
def server_error(error):
    logger.error(f"[SERVER ERROR] {str(error)}")
    return jsonify({
        'status': 'error',
        'message': 'Internal server error'
    }), 500

# ============================================
# Main App Entry Point
# ============================================

if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info("[BOOT] SmartConvert Starting")
    logger.info(f"[BOOT] Debug Mode: {os.getenv('FLASK_ENV') == 'development'}")
    logger.info(f"[BOOT] Upload Folder: {UPLOAD_FOLDER}")
    logger.info(f"[BOOT] Output Folder: {OUTPUT_FOLDER}")
    logger.info(f"[BOOT] PDF Tools: {'Available' if PDF_TOOLS_AVAILABLE else 'Not Available'}")
    logger.info(f"[BOOT] Image Tools: {'Available' if IMAGE_TOOLS_AVAILABLE else 'Not Available'}")
    logger.info("=" * 60)
    
    # Run Flask app
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', '5000')),
        debug=os.getenv('FLASK_ENV') == 'development'
    )
