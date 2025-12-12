import os
import re
import shutil
import subprocess
import logging
import uuid
import json
from datetime import datetime
from flask import Flask, request, render_template, Response, stream_with_context, session, jsonify, send_file
from flask_session import Session
from werkzeug.utils import secure_filename
import secrets

# ---------------------------
# Configuration
# ---------------------------
class Config:
    # Generate secure secret key
    SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_hex(32))
    SESSION_TYPE = 'filesystem'
    DEBUG = os.environ.get('DEBUG', 'False') == 'True'
    
    # Ollama settings
    OLLAMA_PATH = shutil.which("ollama") or "/usr/local/bin/ollama"
    DEFAULT_MODEL = "deepseek-r1:14b"
    
    # Default available models (can be extended by users)
    DEFAULT_MODELS = [
        "deepseek-r1:14b",
        "deepseek-r1:8b",
        "deepseek-r1:7b",
        "deepseek-r1:1.5b",
        "qwen2.5:latest",
        "codellama:13b",
        "llama3.2:latest"
    ]
    
    # Server configuration
    HOST = "0.0.0.0"  # Use "localhost" for local-only access
    PORT = 5025
    
    # File upload settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size
    UPLOAD_FOLDER = 'uploads'
    ALLOWED_EXTENSIONS = {'txt', 'md', 'json'}
    
    # Security settings - disable CSRF for local AI application
    WTF_CSRF_ENABLED = False

# ---------------------------
# Initialize Flask Application
# ---------------------------
app = Flask(__name__)
app.config.from_object(Config)
Session(app)

# Note: CSRF protection disabled for local AI application
# If you need CSRF protection in production, enable it and add proper token handling

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if app.config['DEBUG'] else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ANSI escape sequence cleaner (for cleaning LLM output)
ansi_escape = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')

## let's fix the DEFAULT Models in the Config class

def extract_models() -> list:
    try: ## in case ollama is not installed properly
        command = "ollama list > temp.txt"
        os.system(command)
    except Exception as es:
        print(f"Has ollama been properly installed? Error code is =-> {es}")
        x = input("Press ENTER to terminate.")
        sys.exit()

    with open("temp.txt") as fd:
        result = fd.readlines()
    os.remove("temp.txt")

    index = 0
    name_list = []
    for element in result:
        if index == 0:
            index += 1
            continue
        temp_list = element.split(' ')
        name_list.append(temp_list[0])

    return name_list

# ---------------------------
# Helper Functions
# ---------------------------
def generate_chat_id() -> str:
    """Generate a unique chat identifier using UUID4."""
    return str(uuid.uuid4())

def get_user_models() -> list:
    """Get user's custom models from session, merged with defaults."""
    user_models = session.get('user_models', [])
    #all_models = list(Config.DEFAULT_MODELS)
    all_models = extract_models()
    
    # Add user models that aren't already in defaults
    for model in user_models:
        if model not in all_models:
            all_models.append(model)
    
    return all_models

def add_user_model(model_name: str) -> tuple[bool, str]:
    """Add a custom model to user's list."""
    try:
        # Validate model name format
        if not re.match(r'^[a-zA-Z0-9._:-]+$', model_name):
            return False, "Invalid model name format. Use only letters, numbers, dots, hyphens, colons, and underscores."
        
        if len(model_name) > 100:
            return False, "Model name too long (max 100 characters)."
        
        # Check if model exists in Ollama
        result = subprocess.run(
            [Config.OLLAMA_PATH, "list"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode != 0:
            return False, "Unable to connect to Ollama. Please ensure Ollama is running."
        
        available_models = [line.split()[0] for line in result.stdout.strip().split('\n') if line.strip()]
        
        if model_name not in available_models:
            return False, f"Model '{model_name}' not found in Ollama. Please pull the model first with: ollama pull {model_name}"
        
        # Add to session
        if 'user_models' not in session:
            session['user_models'] = []
        
        if model_name not in session['user_models']:
            session['user_models'].append(model_name)
            session.modified = True
            logger.info(f"Added custom model: {model_name}")
            return True, f"Successfully added model '{model_name}'"
        else:
            return False, f"Model '{model_name}' is already in your list."
            
    except subprocess.TimeoutExpired:
        return False, "Timeout while checking Ollama models. Please try again."
    except Exception as e:
        logger.error(f"Error adding model {model_name}: {str(e)}")
        return False, "An error occurred while adding the model. Please try again."

def remove_user_model(model_name: str) -> tuple[bool, str]:
    """Remove a custom model from user's list."""
    if 'user_models' not in session:
        return False, "No custom models to remove."
    
    #if model_name in Config.DEFAULT_MODELS:
    ## Do not remove the last model
    if len(extract_models()) == 1:
        return False, "Cannot remove model."
    
    if model_name in session['user_models']:
        session['user_models'].remove(model_name)
        session.modified = True
        logger.info(f"Removed custom model: {model_name}")
        return True, f"Successfully removed model '{model_name}'"
    else:
        return False, f"Model '{model_name}' not found in your custom models."

def validate_input(data: dict, required_fields: list) -> tuple[bool, str]:
    """Validate input data for required fields and basic sanitization."""
    for field in required_fields:
        if field not in data or not data.get(field, '').strip():
            return False, f"The field '{field}' is required and cannot be empty."
    
    # Basic length validation
    if 'prompt' in data and len(data['prompt']) > 10000:
        return False, "Your message is too long. Please keep it under 10,000 characters."
    
    if 'chat_id' in data and not re.match(r'^[a-f0-9-]{36}$', data['chat_id']):
        return False, "Invalid chat session. Please refresh the page and try again."
    
    if 'model' in data and len(data['model']) > 100:
        return False, "Model name is too long."
    
    return True, ""

def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe storage."""
    return secure_filename(filename)

def allowed_file(filename: str) -> bool:
    """Check if file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def initialize_chat_history(chat_id: str):
    """Initialize chat history for a new chat."""
    if 'chat_histories' not in session:
        session['chat_histories'] = {}
    session['chat_histories'][chat_id] = []
    session.modified = True
    logger.debug(f"Initialized chat history for chat_id {chat_id}.")

def append_message(chat_id: str, role: str, content: str):
    """Append a message to the chat history."""
    if 'chat_histories' not in session:
        session['chat_histories'] = {}
    if chat_id not in session['chat_histories']:
        initialize_chat_history(chat_id)
    
    message = {
        "role": role, 
        "content": content,
        "timestamp": datetime.now().isoformat()
    }
    session['chat_histories'][chat_id].append(message)
    session.modified = True
    logger.debug(f"Appended {role} message to chat_id {chat_id}")

def build_full_prompt(chat_id: str) -> str:
    """Build the full prompt including chat history."""
    full_prompt = ""
    for message in session['chat_histories'].get(chat_id, []):
        role = "Human" if message["role"] == "user" else "Assistant"
        full_prompt += f"{role}: {message['content']}\n"
    logger.debug(f"Full prompt for chat_id {chat_id}:\n{full_prompt}")
    return full_prompt

def search_chat_history(query: str) -> list:
    """Search through all chat histories for messages containing the query."""
    results = []
    if 'chat_histories' not in session:
        return results
    
    query_lower = query.lower()
    for chat_id, messages in session['chat_histories'].items():
        for i, message in enumerate(messages):
            if query_lower in message['content'].lower():
                results.append({
                    'chat_id': chat_id,
                    'message_index': i,
                    'role': message['role'],
                    'content': message['content'][:200] + '...' if len(message['content']) > 200 else message['content'],
                    'timestamp': message.get('timestamp', 'Unknown')
                })
    return results

# ---------------------------
# Routes
# ---------------------------
@app.route("/health", methods=["GET"])
def health_check():
    """Endpoint for system health monitoring."""
    try:
        result = subprocess.run(
            [Config.OLLAMA_PATH, "--version"],
            capture_output=True,
            check=True,
            text=True,
            timeout=5
        )
        logger.debug(f"Ollama version: {result.stdout.strip()}")
        return jsonify({
            "status": "healthy",
            "ollama": "accessible",
            "version": result.stdout.strip(),
            "timestamp": datetime.now().isoformat(),
            "message": "System is running normally"
        }), 200
    except subprocess.TimeoutExpired:
        logger.error("Health check timed out")
        return jsonify({
            "status": "unhealthy", 
            "error": "Ollama connection timeout",
            "message": "Unable to connect to Ollama within 5 seconds",
            "timestamp": datetime.now().isoformat()
        }), 503
    except subprocess.CalledProcessError as e:
        logger.error(f"Ollama command failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "error": "Ollama command failed",
            "message": "Ollama may not be installed or accessible",
            "timestamp": datetime.now().isoformat()
        }), 503
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            "status": "unhealthy", 
            "error": str(e),
            "message": "An unexpected error occurred during health check",
            "timestamp": datetime.now().isoformat()
        }), 503

@app.route("/models", methods=["GET"])
def list_models():
    """Endpoint to list available Ollama models."""
    try:
        result = subprocess.run(
            [Config.OLLAMA_PATH, "list"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10
        )
        models = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
        logger.debug(f"Available models: {models}")
        return jsonify({
            "models": models,
            "message": f"Found {len(models)} available models"
        }), 200
    except subprocess.TimeoutExpired:
        return jsonify({
            "error": "Request timeout", 
            "message": "Unable to retrieve models within 10 seconds. Please try again."
        }), 500
    except subprocess.CalledProcessError as e:
        return jsonify({
            "error": "Ollama error",
            "message": "Unable to retrieve models from Ollama. Please ensure Ollama is running."
        }), 500
    except Exception as e:
        logger.error(f"Failed to list models: {str(e)}")
        return jsonify({
            "error": "Server error",
            "message": "An unexpected error occurred while retrieving models."
        }), 500

@app.route("/add_model", methods=["POST"])
def add_model():
    """Add a custom model to user's list."""
    try:
        data = request.get_json(silent=True) or {}
        valid, error_msg = validate_input(data, ['model_name'])
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        model_name = data['model_name'].strip()
        success, message = add_user_model(model_name)
        
        if success:
            return jsonify({
                "message": message,
                "models": get_user_models()
            }), 200
        else:
            return jsonify({"error": message}), 400
            
    except Exception as e:
        logger.error(f"Add model error: {str(e)}")
        return jsonify({
            "error": "Server error",
            "message": "An unexpected error occurred while adding the model."
        }), 500

@app.route("/remove_model", methods=["POST"])
def remove_model():
    """Remove a custom model from user's list."""
    try:
        data = request.get_json(silent=True) or {}
        valid, error_msg = validate_input(data, ['model_name'])
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        model_name = data['model_name'].strip()
        success, message = remove_user_model(model_name)
        
        if success:
            return jsonify({
                "message": message,
                "models": get_user_models()
            }), 200
        else:
            return jsonify({"error": message}), 400
            
    except Exception as e:
        logger.error(f"Remove model error: {str(e)}")
        return jsonify({
            "error": "Server error",
            "message": "An unexpected error occurred while removing the model."
        }), 500

@app.route("/search", methods=["POST"])
def search():
    """Search through chat histories."""
    try:
        data = request.get_json(silent=True) or {}
        valid, error_msg = validate_input(data, ['query'])
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        query = data['query'].strip()
        if len(query) < 2:
            return jsonify({
                "error": "Search query too short",
                "message": "Please enter at least 2 characters to search."
            }), 400
        
        results = search_chat_history(query)
        
        return jsonify({
            "results": results,
            "message": f"Found {len(results)} results for '{query}'"
        }), 200
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        return jsonify({
            "error": "Search failed",
            "message": "An error occurred while searching. Please try again."
        }), 500

@app.route("/export", methods=["GET"])
def export_chats():
    """Export all chat histories as JSON."""
    try:
        if not session.get('chat_histories'):
            return jsonify({
                "error": "No chats to export",
                "message": "You don't have any chat histories to export."
            }), 400
        
        chat_data = {
            "export_timestamp": datetime.now().isoformat(),
            "chat_histories": session.get('chat_histories', {}),
            "user_models": session.get('user_models', []),
            "version": "1.0"
        }
        
        filename = f"chat_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(chat_data, f, indent=2, ensure_ascii=False)
        
        return send_file(filepath, as_attachment=True, download_name=filename)
    except Exception as e:
        logger.error(f"Export error: {str(e)}")
        return jsonify({
            "error": "Export failed",
            "message": "An error occurred while exporting your chats. Please try again."
        }), 500

@app.route("/import", methods=["POST"])
def import_chats():
    """Import chat histories from JSON file."""
    try:
        if 'file' not in request.files:
            return jsonify({
                "error": "No file provided",
                "message": "Please select a file to import."
            }), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({
                "error": "No file selected",
                "message": "Please select a valid file."
            }), 400
        
        if not allowed_file(file.filename):
            return jsonify({
                "error": "Invalid file type",
                "message": "Only JSON files are allowed for import."
            }), 400
        
        # Read and parse JSON
        try:
            content = file.read().decode('utf-8')
            data = json.loads(content)
        except UnicodeDecodeError:
            return jsonify({
                "error": "File encoding error",
                "message": "Unable to read the file. Please ensure it's a valid UTF-8 encoded JSON file."
            }), 400
        except json.JSONDecodeError as e:
            return jsonify({
                "error": "Invalid JSON format",
                "message": f"The file contains invalid JSON: {str(e)}"
            }), 400
        
        if 'chat_histories' not in data:
            return jsonify({
                "error": "Invalid file format",
                "message": "The file doesn't contain valid chat history data."
            }), 400
        
        # Merge with existing chat histories
        if 'chat_histories' not in session:
            session['chat_histories'] = {}
        
        imported_count = 0
        for chat_id, messages in data['chat_histories'].items():
            if chat_id not in session['chat_histories']:
                session['chat_histories'][chat_id] = messages
                imported_count += 1
        
        # Import user models if available
        if 'user_models' in data:
            if 'user_models' not in session:
                session['user_models'] = []
            for model in data['user_models']:
                if model not in session['user_models']:
                    session['user_models'].append(model)
        
        session.modified = True
        return jsonify({
            "message": f"Successfully imported {imported_count} chats",
            "imported_count": imported_count
        }), 200
        
    except Exception as e:
        logger.error(f"Import error: {str(e)}")
        return jsonify({
            "error": "Import failed",
            "message": "An error occurred while importing the file. Please try again."
        }), 500

@app.route("/", methods=["GET"])
def index():
    """Render main chat interface."""
    return render_template('index.html', models=get_user_models())

@app.route("/stream_chat", methods=["POST"])
def stream_chat():
    """Handle streaming chat requests with conversation context."""
    try:
        data = request.get_json(silent=True) or {}
        valid, error_msg = validate_input(data, ['prompt', 'model', 'chat_id'])
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        prompt = data['prompt'].strip()
        model = data['model'].strip()
        chat_id = data['chat_id'].strip()

        # Initialize chat history if not present
        if 'chat_histories' not in session or chat_id not in session['chat_histories']:
            initialize_chat_history(chat_id)
        
        available_models = get_user_models()
        if model not in available_models:
            return jsonify({
                "error": "Model not available",
                "message": f"The model '{model}' is not in your available models list."
            }), 400
        
        # Append user prompt to chat history
        append_message(chat_id, "user", prompt)
        
        # Build full conversation prompt
        full_prompt = build_full_prompt(chat_id)
        logger.info(f"Processing chat_id {chat_id} with model {model}.")

        def sse_generator():
            try:
                # Launch the LLM subprocess
                with subprocess.Popen(
                    [Config.OLLAMA_PATH, "run", model],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    universal_newlines=True,
                    bufsize=1
                ) as proc:
                    if proc.stdin:
                        proc.stdin.write(full_prompt)
                        proc.stdin.close()
                        logger.debug(f"Written prompt to Ollama subprocess for chat_id {chat_id}.")
                    
                    assistant_response = ""
                    # Stream and clean output line by line
                    for line in proc.stdout:
                        clean_line = ansi_escape.sub('', line)
                        if clean_line.strip():
                            logger.debug(f"Ollama output for chat_id {chat_id}: {clean_line.strip()}")
                            assistant_response += clean_line
                            yield f"data: {clean_line}\n\n"
                    
                    # Append assistant's response to chat history
                    append_message(chat_id, "assistant", assistant_response.strip())
                    
                    # Check for any error output
                    err_output = proc.stderr.read()
                    return_code = proc.wait()
                    if return_code != 0:
                        error_messages = {
                            1: "Model not found. Please ensure the model is pulled with 'ollama pull'",
                            2: "Invalid model format or corrupted model",
                            3: "Insufficient system resources",
                            127: "Ollama command not found. Please ensure Ollama is installed and in PATH"
                        }
                        err_msg = error_messages.get(return_code, f"Ollama exited with code {return_code}")
                        if err_output.strip():
                            err_msg += f": {err_output.strip()}"
                        logger.error(f"Ollama error for chat_id {chat_id}: {err_msg}")
                        yield f"data: Error: {err_msg}\n\n"
                    
                    yield "data: [DONE]\n\n"
            except Exception as e:
                logger.error(f"Stream error for chat_id {chat_id}: {str(e)}")
                yield f"data: Error: An unexpected error occurred while processing your request.\n\n"
                yield "data: [DONE]\n\n"
        
        return Response(stream_with_context(sse_generator()), mimetype='text/event-stream')
        
    except Exception as e:
        logger.error(f"Stream chat error: {str(e)}")
        return jsonify({
            "error": "Streaming failed",
            "message": "An error occurred while processing your message. Please try again."
        }), 500

@app.route("/reset_chat", methods=["POST"])
def reset_chat():
    """Endpoint to reset a specific chat history."""
    try:
        data = request.get_json(silent=True) or {}
        valid, error_msg = validate_input(data, ['chat_id'])
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        chat_id = data['chat_id'].strip()
        
        if 'chat_histories' in session and chat_id in session['chat_histories']:
            del session['chat_histories'][chat_id]
            session.modified = True
            logger.info(f"Chat history for chat_id {chat_id} has been reset.")
            return jsonify({
                "status": "success",
                "message": f"Chat history has been cleared successfully."
            }), 200
        else:
            logger.warning(f"No chat history found for chat_id {chat_id}.")
            return jsonify({
                "error": "Chat not found",
                "message": "The specified chat could not be found."
            }), 404
            
    except Exception as e:
        logger.error(f"Reset chat error: {str(e)}")
        return jsonify({
            "error": "Reset failed",
            "message": "An error occurred while clearing the chat. Please try again."
        }), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({
        "error": "Page not found",
        "message": "The requested page or endpoint could not be found."
    }), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({
        "error": "Internal server error",
        "message": "An unexpected error occurred. Please try again or contact support if the issue persists."
    }), 500

@app.errorhandler(413)
def file_too_large(error):
    """Handle file too large errors."""
    return jsonify({
        "error": "File too large",
        "message": "The uploaded file is too large. Please choose a file smaller than 16MB."
    }), 413

@app.errorhandler(429)
def rate_limit_exceeded(error):
    """Handle rate limit errors."""
    return jsonify({
        "error": "Too many requests",
        "message": "You're sending requests too quickly. Please wait a moment and try again."
    }), 429

# ---------------------------
# Main Entry Point
# ---------------------------
if __name__ == "__main__":
    logger.info(f"Starting server on {Config.HOST}:{Config.PORT}")
    logger.info(f"Using Ollama path: {Config.OLLAMA_PATH}")
    logger.info(f"Secret key configured: {'Yes' if Config.SECRET_KEY else 'No'}")
    logger.info(f"Debug mode: {'Enabled' if Config.DEBUG else 'Disabled'}")
    logger.info("CSRF protection: Disabled (local AI application)")
    app.run(
        host=Config.HOST,
        port=Config.PORT,
        debug=Config.DEBUG,
        threaded=True
    )