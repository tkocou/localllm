/**
 * Local AI GUI - Enhanced Client-Side Application
 *
 * Features:
 * - Multi-chat management with search functionality
 * - Export/import chat histories
 * - Real-time statistics
 * - Enhanced error handling and user feedback
 * - Accessibility improvements
 * - Modern UI interactions
 * - Custom model management
 */

// =========================
// Global State Management
// =========================
let chats = {}; // { chat_id: { name: "Chat Title", messages: [ { question, answer }, ... ] } }
let currentChatId = "";
let selectedModel = null;
let isStreaming = false;
let availableModels = [];
let userModels = [];

// DOM Element References
const chatWindow = document.getElementById('chatWindow');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const chatList = document.getElementById('chatList');
const modelSelect = document.getElementById('modelSelect');
const newChatBtn = document.getElementById('newChatBtn');
const chatTitle = document.getElementById('chatTitle');
const charCount = document.getElementById('charCount');

// Search elements
const searchBtn = document.getElementById('searchBtn');
const searchSection = document.getElementById('searchSection');
const searchInput = document.getElementById('searchInput');
const searchExecuteBtn = document.getElementById('searchExecuteBtn');
const searchResults = document.getElementById('searchResults');

// Export/Import elements
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const fileInput = document.getElementById('fileInput');

// UI elements
const toast = document.getElementById('toast');
const loadingOverlay = document.getElementById('loadingOverlay');
const confirmModal = document.getElementById('confirmModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

// Statistics elements
const totalChats = document.getElementById('totalChats');
const totalMessages = document.getElementById('totalMessages');
const activeModel = document.getElementById('activeModel');
const customModels = document.getElementById('customModels');

// Chat controls
const clearChatBtn = document.getElementById('clearChatBtn');
const copyChatBtn = document.getElementById('copyChatBtn');

// Model management elements
const manageModelsBtn = document.getElementById('manageModelsBtn');
const modelManagementModal = document.getElementById('modelManagementModal');
const closeModelModal = document.getElementById('closeModelModal');
const modelNameInput = document.getElementById('modelNameInput');
const addModelBtn = document.getElementById('addModelBtn');
const modelsList = document.getElementById('modelsList');
const refreshOllamaModels = document.getElementById('refreshOllamaModels');
const ollamaModelsList = document.getElementById('ollamaModelsList');

// =========================
// Utility Functions
// =========================

function generateUUID() {
  var d = new Date().getTime();
  var d2 = (performance && performance.now && (performance.now() * 1000)) || 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

function showLoading(show = true) {
  loadingOverlay.style.display = show ? 'flex' : 'none';
}

function showConfirmModal(title, message, onConfirm) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  confirmModal.style.display = 'flex';
  
  const handleConfirm = () => {
    confirmModal.style.display = 'none';
    modalConfirm.removeEventListener('click', handleConfirm);
    modalCancel.removeEventListener('click', handleCancel);
    onConfirm();
  };
  
  const handleCancel = () => {
    confirmModal.style.display = 'none';
    modalConfirm.removeEventListener('click', handleConfirm);
    modalCancel.removeEventListener('click', handleCancel);
  };
  
  modalConfirm.addEventListener('click', handleConfirm);
  modalCancel.addEventListener('click', handleCancel);
}

function handleApiError(error, defaultMessage = "An unexpected error occurred") {
  let message = defaultMessage;
  
  if (error.message) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  }
  
  showToast(message, 'error');
  console.error('API Error:', error);
}

function updateCharCounter() {
  const count = userInput.value.length;
  charCount.textContent = count;
  
  if (count > 8000) {
    charCount.style.color = 'var(--error-color)';
  } else if (count > 6000) {
    charCount.style.color = 'var(--warning-color)';
  } else {
    charCount.style.color = 'var(--text-secondary)';
  }
}

function updateSendButton() {
  const hasText = userInput.value.trim().length > 0;
  const notMaxLength = userInput.value.length <= 10000;
  sendBtn.disabled = !hasText || !notMaxLength || isStreaming || !selectedModel;
}

function updateStatistics() {
  const chatCount = Object.keys(chats).length;
  let messageCount = 0;
  
  Object.values(chats).forEach(chat => {
    messageCount += chat.messages.length * 2; // Each Q&A pair counts as 2 messages
  });
  
  // Count custom models (not in default list)
  const defaultModels = availableModels.slice(0, 7); // Assuming first 7 are defaults
  const customModelCount = availableModels.filter(model => !defaultModels.includes(model)).length;
  
  totalChats.textContent = chatCount;
  totalMessages.textContent = messageCount;
  activeModel.textContent = selectedModel || '-';
  customModels.textContent = customModelCount;
}

function updateModelSelect() {
  const currentValue = modelSelect.value;
  modelSelect.innerHTML = '';
  
  availableModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
  
  // Restore selection if still available
  if (availableModels.includes(currentValue)) {
    modelSelect.value = currentValue;
    selectedModel = currentValue;
  } else if (availableModels.length > 0) {
    modelSelect.value = availableModels[0];
    selectedModel = availableModels[0];
  }
  
  updateStatistics();
}

function cleanDeepSeekOutput(text) {
  // Remove <think> tags and content
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Insert newlines after periods for better readability
  cleaned = cleaned.replace(/\. /g, '.\n');
  return cleaned;
}

function escapeHtml(unsafe) {
  return unsafe.replace(/[&<"'>]/g, function (match) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return map[match];
  });
}

// =========================
// Model Management
// =========================

function showModelManagementModal() {
  modelManagementModal.style.display = 'flex';
  refreshCurrentModels();
  refreshOllamaModelsList();
}

function hideModelManagementModal() {
  modelManagementModal.style.display = 'none';
  modelNameInput.value = '';
}

function refreshCurrentModels() {
  modelsList.innerHTML = '';
  
  if (availableModels.length === 0) {
    modelsList.innerHTML = '<div class="no-models">No models available</div>';
    return;
  }
  
  availableModels.forEach((model, index) => {
    const modelItem = document.createElement('div');
    modelItem.className = 'model-item';
    
    const isDefault = index < 7; // Assuming first 7 are defaults
    
    modelItem.innerHTML = `
      <div>
        <span class="model-name">${escapeHtml(model)}</span>
        ${isDefault ? '<span class="model-type">Default</span>' : '<span class="model-type">Custom</span>'}
      </div>
      <div class="model-actions">
        ${!isDefault ? `<button class="remove-model-btn" onclick="removeModel('${escapeHtml(model)}')">
          <i class="fas fa-trash"></i> Remove
        </button>` : ''}
      </div>
    `;
    
    modelsList.appendChild(modelItem);
  });
}

async function addCustomModel() {
  const modelName = modelNameInput.value.trim();
  if (!modelName) {
    showToast('Please enter a model name', 'warning');
    return;
  }
  
  try {
    showLoading(true);
    const response = await fetch('/add_model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: modelName })
    });
    
    const result = await response.json();
    if (response.ok) {
      availableModels = result.models;
      updateModelSelect();
      refreshCurrentModels();
      modelNameInput.value = '';
      showToast(result.message);
    } else {
      handleApiError(result.error || 'Failed to add model');
    }
  } catch (error) {
    handleApiError(error, 'Failed to add model');
  } finally {
    showLoading(false);
  }
}

async function removeModel(modelName) {
  try {
    showLoading(true);
    const response = await fetch('/remove_model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: modelName })
    });
    
    const result = await response.json();
    if (response.ok) {
      availableModels = result.models;
      updateModelSelect();
      refreshCurrentModels();
      showToast(result.message);
    } else {
      handleApiError(result.error || 'Failed to remove model');
    }
  } catch (error) {
    handleApiError(error, 'Failed to remove model');
  } finally {
    showLoading(false);
  }
}

async function refreshOllamaModelsList() {
  ollamaModelsList.innerHTML = '<div class="loading-models"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  
  try {
    const response = await fetch('/models');
    const result = await response.json();
    
    if (response.ok) {
      ollamaModelsList.innerHTML = '';
      
      if (result.models.length === 0) {
        ollamaModelsList.innerHTML = '<div class="no-models">No models found in Ollama</div>';
        return;
      }
      
      result.models.forEach(model => {
        const modelItem = document.createElement('div');
        modelItem.className = 'model-item';
        
        const isInCurrentList = availableModels.includes(model);
        
        modelItem.innerHTML = `
          <div>
            <span class="model-name">${escapeHtml(model)}</span>
          </div>
          <div class="model-actions">
            ${!isInCurrentList ? `<button class="add-existing-btn" onclick="addExistingModel('${escapeHtml(model)}')">
              <i class="fas fa-plus"></i> Add
            </button>` : '<span style="color: var(--success-color); font-size: 0.8rem;">✓ Added</span>'}
          </div>
        `;
        
        ollamaModelsList.appendChild(modelItem);
      });
    } else {
      ollamaModelsList.innerHTML = `<div class="no-models">Error: ${result.message || 'Failed to load models'}</div>`;
    }
  } catch (error) {
    ollamaModelsList.innerHTML = '<div class="no-models">Failed to connect to Ollama</div>';
  }
}

async function addExistingModel(modelName) {
  modelNameInput.value = modelName;
  await addCustomModel();
  refreshOllamaModelsList();
}

// =========================
// Chat Management
// =========================

function createNewChat(defaultName) {
  const chatName = defaultName || prompt("Enter a name for the new chat:");
  if (!chatName) return;

  const chatId = generateUUID();
  chats[chatId] = {
    name: chatName,
    messages: [],
    createdAt: new Date().toISOString()
  };
  currentChatId = chatId;
  renderChatList();
  renderMessages();
  updateChatTitle();
  updateStatistics();
  showToast(`Created new chat: ${chatName}`);
}

function switchToChat(chatId) {
  if (chatId === currentChatId) return;
  
  currentChatId = chatId;
  renderMessages();
  updateChatTitle();
  renderChatList(); // Update active state
}

function updateChatTitle() {
  if (currentChatId && chats[currentChatId]) {
    chatTitle.textContent = chats[currentChatId].name;
  } else {
    chatTitle.textContent = 'Chat';
  }
}

function renderChatList() {
  chatList.innerHTML = "";
  Object.keys(chats).forEach(chatId => {
    const chat = chats[chatId];
    const li = document.createElement('li');
    li.setAttribute('role', 'listitem');
    
    if (chatId === currentChatId) {
      li.classList.add('active');
    }

    const chatNameSpan = document.createElement('span');
    chatNameSpan.textContent = chat.name;
    chatNameSpan.style.cursor = 'pointer';
    chatNameSpan.style.flex = '1';
    chatNameSpan.onclick = () => switchToChat(chatId);

    const resetBtn = document.createElement('button');
    resetBtn.innerHTML = '<i class="fas fa-redo"></i>';
    resetBtn.className = 'icon-btn';
    resetBtn.title = 'Reset chat';
    resetBtn.onclick = async (e) => {
      e.stopPropagation();
      showConfirmModal(
        'Reset Chat', 
        `Are you sure you want to reset "${chat.name}"? This will clear all messages.`,
        () => resetChat(chatId)
      );
    };

    li.appendChild(chatNameSpan);
    li.appendChild(resetBtn);
    chatList.appendChild(li);
  });
  updateStatistics();
}

async function resetChat(chatId) {
  try {
    showLoading(true);
    const response = await fetch('/reset_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId })
    });
    
    const result = await response.json();
    if (response.ok) {
      chats[chatId].messages = [];
      if (chatId === currentChatId) {
        renderMessages();
      }
      renderChatList();
      showToast(result.message || 'Chat reset successfully');
    } else {
      handleApiError(result.error || 'Failed to reset chat');
    }
  } catch (err) {
    handleApiError(err, 'Failed to reset chat');
  } finally {
    showLoading(false);
  }
}

function renderMessages() {
  chatWindow.innerHTML = "";
  
  if (!chats[currentChatId] || chats[currentChatId].messages.length === 0) {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
      <div class="welcome-content">
        <i class="fas fa-robot welcome-icon"></i>
        <h3>Welcome to Local AI Chat!</h3>
        <p>Start a conversation with your local AI model. Type your message below and press Enter or click Send.</p>
        <div class="welcome-features">
          <div class="feature-item">
            <i class="fas fa-search"></i>
            <span>Search chat history</span>
          </div>
          <div class="feature-item">
            <i class="fas fa-download"></i>
            <span>Export/Import chats</span>
          </div>
          <div class="feature-item">
            <i class="fas fa-cogs"></i>
            <span>Add custom models</span>
          </div>
        </div>
      </div>
    `;
    chatWindow.appendChild(welcomeDiv);
    return;
  }
  
  chats[currentChatId].messages.forEach(qa => {
    addMessageToChat({ type: 'user', content: qa.question });
    addMessageToChat({ type: 'assistant', content: qa.answer });
  });
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function addMessageToChat({ type, content }) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.setAttribute('role', type === 'user' ? 'log' : 'log');
  
  const p = document.createElement('p');
  if (type === 'assistant') {
    // Render markdown using Marked.js
    p.innerHTML = marked.parse(content);
  } else {
    p.textContent = content;
  }
  messageDiv.appendChild(p);
  chatWindow.appendChild(messageDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// =========================
// Search Functionality
// =========================

function toggleSearch() {
  const isVisible = searchSection.style.display !== 'none';
  searchSection.style.display = isVisible ? 'none' : 'block';
  
  if (!isVisible) {
    searchInput.focus();
  } else {
    searchResults.innerHTML = '';
  }
}

async function executeSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    showToast('Please enter a search query', 'warning');
    return;
  }
  
  if (query.length < 2) {
    showToast('Please enter at least 2 characters', 'warning');
    return;
  }
  
  try {
    showLoading(true);
    const response = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    
    const result = await response.json();
    if (response.ok) {
      displaySearchResults(result.results);
      if (result.results.length === 0) {
        showToast(result.message || 'No results found', 'warning');
      } else {
        showToast(result.message || `Found ${result.results.length} results`);
      }
    } else {
      handleApiError(result.error || 'Search failed');
    }
  } catch (err) {
    handleApiError(err, 'Search failed');
  } finally {
    showLoading(false);
  }
}

function displaySearchResults(results) {
  searchResults.innerHTML = '';
  
  results.forEach(result => {
    const resultDiv = document.createElement('div');
    resultDiv.className = 'search-result-item';
    resultDiv.onclick = () => {
      switchToChat(result.chat_id);
      toggleSearch();
    };
    
    resultDiv.innerHTML = `
      <div class="search-result-role">${result.role}</div>
      <div class="search-result-content">${escapeHtml(result.content)}</div>
      <div class="search-result-time">${new Date(result.timestamp).toLocaleString()}</div>
    `;
    
    searchResults.appendChild(resultDiv);
  });
}

// =========================
// Export/Import Functionality
// =========================

async function exportChats() {
  try {
    showLoading(true);
    const response = await fetch('/export');
    
    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `chat_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Chats exported successfully');
    } else {
      const result = await response.json();
      handleApiError(result.error || 'Export failed');
    }
  } catch (err) {
    handleApiError(err, 'Export failed');
  } finally {
    showLoading(false);
  }
}

function triggerImport() {
  fileInput.click();
}

async function importChats(file) {
  try {
    showLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch('/import', {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    if (response.ok) {
      showToast(result.message);
      // Refresh the UI
      setTimeout(() => location.reload(), 1000);
    } else {
      handleApiError(result.error || 'Import failed');
    }
  } catch (err) {
    handleApiError(err, 'Import failed');
  } finally {
    showLoading(false);
  }
}

// =========================
// Chat Controls
// =========================

function clearCurrentChat() {
  if (!currentChatId || !chats[currentChatId]) return;
  
  showConfirmModal(
    'Clear Chat',
    `Are you sure you want to clear all messages in "${chats[currentChatId].name}"?`,
    () => resetChat(currentChatId)
  );
}

function copyChatToClipboard() {
  if (!currentChatId || !chats[currentChatId]) return;
  
  let content = `Chat: ${chats[currentChatId].name}\n`;
  content += `Exported: ${new Date().toLocaleString()}\n\n`;
  
  chats[currentChatId].messages.forEach((qa, index) => {
    content += `--- Message ${index + 1} ---\n`;
    content += `User: ${qa.question}\n\n`;
    content += `Assistant: ${qa.answer}\n\n`;
  });
  
  navigator.clipboard.writeText(content).then(() => {
    showToast('Chat copied to clipboard');
  }).catch(() => {
    showToast('Failed to copy chat', 'error');
  });
}

// =========================
// Message Sending & Streaming
// =========================

function handleTextareaKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const prompt = userInput.value.trim();
  if (!prompt || isStreaming) return;
  
  if (!selectedModel) {
    showToast('Please select a model first', 'warning');
    return;
  }
  
  if (!currentChatId) {
    createNewChat("Chat " + (Object.keys(chats).length + 1));
  }
  
  // Add user message to current chat
  if (!chats[currentChatId]) {
    chats[currentChatId] = { name: "Unnamed Chat", messages: [] };
  }
  
  chats[currentChatId].messages.push({ question: prompt, answer: "" });
  addMessageToChat({ type: 'user', content: prompt });
  userInput.value = '';
  updateCharCounter();
  updateSendButton();
  
  const { contentElement, rawPre } = createAssistantMessageElements();
  isStreaming = true;
  updateSendButton();

  try {
    const response = await fetch('/stream_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: selectedModel, chat_id: currentChatId })
    });
    
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    await processStreamResponse(response, contentElement, rawPre);
  } catch (err) {
    console.error('Stream error:', err);
    const errorMsg = err.message || 'An unexpected error occurred';
    contentElement.innerHTML += `<br><div style="color: var(--error-color); font-weight: 500;"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(errorMsg)}</div>`;
    if (chats[currentChatId] && chats[currentChatId].messages.length > 0) {
      chats[currentChatId].messages[chats[currentChatId].messages.length - 1].answer = `Error: ${errorMsg}`;
    }
    showToast('Failed to send message', 'error');
  } finally {
    isStreaming = false;
    updateSendButton();
    renderChatList(); // Update statistics
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

function createAssistantMessageElements() {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant formatted-content';
  msgDiv.setAttribute('role', 'log');
  
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = `<span class="stream-content"></span><span class="streaming">|</span>`;
  
  const rawContainer = document.createElement('div');
  rawContainer.className = 'raw-container';
  const rawPre = document.createElement('pre');
  rawContainer.appendChild(rawPre);
  
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle-raw-btn';
  toggleBtn.innerHTML = '<i class="fas fa-code"></i> Show raw output';
  toggleBtn.addEventListener('click', () => {
    if (rawContainer.style.display === 'none' || rawContainer.style.display === '') {
      rawContainer.style.display = 'block';
      toggleBtn.innerHTML = '<i class="fas fa-code"></i> Hide raw output';
    } else {
      rawContainer.style.display = 'none';
      toggleBtn.innerHTML = '<i class="fas fa-code"></i> Show raw output';
    }
  });
  
  rawContainer.style.display = 'none';
  msgDiv.appendChild(contentDiv);
  msgDiv.appendChild(toggleBtn);
  msgDiv.appendChild(rawContainer);
  chatWindow.appendChild(msgDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  
  return {
    contentElement: contentDiv.querySelector('.stream-content'),
    rawPre
  };
}

async function processStreamResponse(response, contentElement, rawPre) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let partialChunk = '';
  let rawText = '';
  const chatIndex = chats[currentChatId].messages.length - 1;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    partialChunk += chunk;
    const lines = partialChunk.split(/\r?\n/);
    partialChunk = lines.pop();
    
    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith('data: ')) {
        const data = line.replace('data: ', '').trim();
        if (data === '[DONE]') {
          const cursor = document.querySelector('.streaming');
          if (cursor) cursor.remove();
          break;
        }
        
        rawText += data + '\n';
        rawPre.textContent = rawText;
        
        if (chats[currentChatId] && chats[currentChatId].messages[chatIndex]) {
          chats[currentChatId].messages[chatIndex].answer += data + '\n';
        }
        
        // Apply cleaning only for DeepSeek models
        let currentAnswer = chats[currentChatId].messages[chatIndex].answer;
        if (selectedModel && selectedModel.toLowerCase().includes('deepseek')) {
          currentAnswer = cleanDeepSeekOutput(currentAnswer);
        }
        
        // Update rendered markdown
        contentElement.innerHTML = marked.parse(currentAnswer);
        if (typeof hljs !== 'undefined') {
          hljs.highlightAll();
        }
        chatWindow.scrollTop = chatWindow.scrollHeight;
      }
    }
  }
  
  const cursor = document.querySelector('.streaming');
  if (cursor) cursor.remove();
}

// =========================
// Event Listeners
// =========================

function initializeEventListeners() {
  // Basic controls
  sendBtn.addEventListener('click', sendMessage);
  userInput.addEventListener('keydown', handleTextareaKeyDown);
  userInput.addEventListener('input', () => {
    updateCharCounter();
    updateSendButton();
  });
  
  modelSelect.addEventListener('change', () => {
    selectedModel = modelSelect.value;
    updateStatistics();
    updateSendButton();
  });
  
  newChatBtn.addEventListener('click', () => {
    createNewChat("Chat " + (Object.keys(chats).length + 1));
  });
  
  // Search functionality
  searchBtn.addEventListener('click', toggleSearch);
  searchExecuteBtn.addEventListener('click', executeSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  });
  
  // Export/Import
  exportBtn.addEventListener('click', exportChats);
  importBtn.addEventListener('click', triggerImport);
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importChats(e.target.files[0]);
    }
  });
  
  // Chat controls
  clearChatBtn.addEventListener('click', clearCurrentChat);
  copyChatBtn.addEventListener('click', copyChatToClipboard);
  
  // Model management
  manageModelsBtn.addEventListener('click', showModelManagementModal);
  closeModelModal.addEventListener('click', hideModelManagementModal);
  addModelBtn.addEventListener('click', addCustomModel);
  refreshOllamaModels.addEventListener('click', refreshOllamaModelsList);
  modelNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addCustomModel();
    }
  });
  
  // Close modal when clicking outside
  modelManagementModal.addEventListener('click', (e) => {
    if (e.target === modelManagementModal) {
      hideModelManagementModal();
    }
  });
  
  // Theme switching
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    const currentTheme = document.documentElement.className;
    themeSelect.value = currentTheme || 'theme-futuristic';
    themeSelect.addEventListener('change', function() {
      document.documentElement.className = this.value;
    });
  }
}

// =========================
// Additional Features
// =========================

function updateDateTime() {
  const datetimeDisplay = document.getElementById('datetimeDisplay');
  if (datetimeDisplay) {
    const now = new Date();
    const options = { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    datetimeDisplay.textContent = now.toLocaleDateString('en-US', options);
  }
}

function initFuturisticCube() {
  const canvas = document.getElementById('futuristicCube');
  if (!canvas || typeof THREE === 'undefined') return;

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    // Create a neon wireframe cube
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const material = new THREE.MeshBasicMaterial({
      color: getComputedStyle(document.documentElement)
        .getPropertyValue('--cube-color').trim(),
      wireframe: true
    });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    function animate() {
      requestAnimationFrame(animate);
      cube.rotation.x += 0.005;
      cube.rotation.y += 0.005;
      renderer.render(scene, camera);
    }
    animate();
  } catch (error) {
    console.warn('3D cube initialization failed:', error);
  }
}

// =========================
// Initialization
// =========================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize components
  initializeEventListeners();
  updateDateTime();
  initFuturisticCube();
  
  // Get available models from the select options
  availableModels = Array.from(modelSelect.options).map(option => option.value);
  
  // Set initial model
  if (modelSelect && modelSelect.options.length > 0) {
    selectedModel = modelSelect.value;
  }
  
  // Create default chat if none exists
  if (!currentChatId) {
    createNewChat("Chat 1");
  }
  
  // Initialize syntax highlighting
  if (typeof hljs !== 'undefined') {
    hljs.highlightAll();
  }
  
  // Update UI state
  updateCharCounter();
  updateSendButton();
  updateStatistics();
  
  // Start datetime updates
  setInterval(updateDateTime, 60000); // Update every minute
  
  console.log('Local AI GUI initialized successfully');
  showToast('Welcome to Local AI Chat! ��', 'success');
});