class SidePanel {
  constructor() {
    this.initializeEventListeners();
    this.loadSavedSettings();
    this.initializeColorLegend();
  }

  initializeEventListeners() {
    // Analyze button
    document.getElementById('analyzeBtn').addEventListener('click', () => {
      this.handleAnalyze();
    });

    // Clear button
    document.getElementById('clearBtn').addEventListener('click', () => {
      this.handleClear();
    });

    // Enter key in query field
    document.getElementById('query').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleAnalyze();
      }
    });

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'ANALYSIS_PROGRESS') {
        this.updateStatus(request.message, 'info');
      }
    });
  }

  async handleAnalyze() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const query = document.getElementById('query').value.trim();

    // Validation
    if (!query) {
      this.showError('Please enter what you want to analyze and highlight');
      return;
    }

    // Save settings
    this.saveSettings(apiKey, query);

    // Show loading state
    this.setLoadingState(true);
    this.updateStatus('Starting analysis...', 'info');

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0] || !tabs[0].id) {
        throw new Error('No active tab found');
      }

      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'analyzeAndHighlight',
        query: query,
        apiKey: apiKey
      });

      if (response) {
        this.handleAnalysisResponse(response);
      } else {
        throw new Error('No response from content script. Please refresh the page and try again.');
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setLoadingState(false);
    }
  }

  handleAnalysisResponse(response) {
    if (response.success) {
      this.showSuccess(
        `Analysis complete! Found ${response.highlightCount} items using ${response.aiUsed} AI. ` +
        `Hover over highlighted text to see details.`
      );
      
      this.updateDetails({
        aiMode: response.aiUsed,
        highlightCount: response.highlightCount,
        textLength: response.textLength
      });
    } else {
      this.handleAnalysisError(response.error, response.details);
    }
  }

  handleAnalysisError(error, details = {}) {
    let errorMessage = 'Analysis failed: ';
    
    // Specific error handling
    if (error.includes('No text content')) {
      errorMessage += 'No readable text found on this page. Try a different website.';
    } else if (error.includes('API key')) {
      errorMessage += 'Invalid or missing Gemini API key. Please check your API key.';
    } else if (error.includes('Network') || error.includes('fetch')) {
      errorMessage += 'Network error. Check your internet connection.';
    } else if (error.includes('quota') || error.includes('limit')) {
      errorMessage += 'API quota exceeded. Try again later or check your API limits.';
    } else if (error.includes('Local AI not available')) {
      errorMessage += 'Chrome\'s built-in AI is not available. Using cloud API requires a valid API key.';
    } else {
      errorMessage += error;
    }

    this.showError(errorMessage, details);
  }

  handleError(error) {
    let errorMessage = 'Unexpected error: ';
    
    if (error.message.includes('Could not establish connection')) {
      errorMessage += 'Extension not properly loaded on this page. Try refreshing the page.';
    } else {
      errorMessage += error.message;
    }

    this.showError(errorMessage);
  }

  async handleClear() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].id) {
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'clearHighlights' });
        this.showSuccess('All highlights cleared');
        this.updateDetails({
          aiMode: 'Not started',
          highlightCount: 0,
          textLength: '--'
        });
      }
    } catch (error) {
      this.showError('Error clearing highlights: ' + error.message);
    }
  }

  showSuccess(message) {
    this.updateStatus(message, 'success');
  }

  showError(message, details = null) {
    this.updateStatus(message, 'error', details);
  }

  updateStatus(message, type = 'info', details = null) {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-message status-${type}`;
    
    // Add error details if provided
    if (details && type === 'error') {
      let detailsText = JSON.stringify(details, null, 2);
      if (typeof details === 'string') {
        detailsText = details;
      }
      
      let detailsElement = statusElement.querySelector('.error-details');
      if (!detailsElement) {
        detailsElement = document.createElement('div');
        detailsElement.className = 'error-details';
        statusElement.appendChild(detailsElement);
      }
      detailsElement.textContent = detailsText;
    } else {
      const detailsElement = statusElement.querySelector('.error-details');
      if (detailsElement) {
        detailsElement.remove();
      }
    }
  }

  setLoadingState(loading) {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const clearBtn = document.getElementById('clearBtn');
    
    if (loading) {
      analyzeBtn.classList.add('loading');
      clearBtn.classList.add('loading');
      analyzeBtn.textContent = 'Analyzing...';
    } else {
      analyzeBtn.classList.remove('loading');
      clearBtn.classList.remove('loading');
      analyzeBtn.textContent = 'Analyze & Highlight';
    }
  }

  updateDetails({ aiMode, highlightCount, textLength }) {
    document.getElementById('aiMode').textContent = `AI Mode: ${aiMode}`;
    document.getElementById('highlightCount').textContent = `Highlights: ${highlightCount}`;
    if (textLength) {
      document.getElementById('textLength').textContent = `Page text: ${textLength} characters`;
    }
  }

  initializeColorLegend() {
    const colors = {
      goal: { color: '#FFA500', label: 'Goals & Objectives' },
      definition: { color: '#90EE90', label: 'Definitions' },
      keypoint: { color: '#87CEEB', label: 'Key Points' },
      risk: { color: '#FFB6C1', label: 'Risks & Challenges' },
      date: { color: '#DDA0DD', label: 'Dates & Timelines' },
      default: { color: '#FFFF00', label: 'Other' }
    };

    const legendElement = document.getElementById('colorLegend');
    legendElement.innerHTML = '';

    Object.entries(colors).forEach(([key, config]) => {
      const colorItem = document.createElement('div');
      colorItem.className = 'color-item';
      colorItem.innerHTML = `
        <div class="color-swatch" style="background-color: ${config.color}"></div>
        <span>${config.label}</span>
      `;
      legendElement.appendChild(colorItem);
    });
  }

  loadSavedSettings() {
    chrome.storage.local.get(['geminiApiKey', 'lastQuery'], (result) => {
      if (result.geminiApiKey) {
        document.getElementById('apiKey').value = result.geminiApiKey;
      }
      if (result.lastQuery) {
        document.getElementById('query').value = result.lastQuery;
      }
    });
  }

  saveSettings(apiKey, query) {
    chrome.storage.local.set({ 
      geminiApiKey: apiKey,
      lastQuery: query 
    });
  }
}

// Initialize side panel when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SidePanel();
});
