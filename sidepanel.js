class SidePanel {
  constructor() {
    this.initializeEventListeners();
    this.loadSavedSettings();
    this.initializeColorLegend();
    this.initializeDarkMode();
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

    // Handle panel resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  initializeDarkMode() {
    const toggle = document.getElementById('darkModeToggle');
    
    // Load saved theme preference
    chrome.storage.local.get(['darkMode'], (result) => {
      const isDarkMode = result.darkMode || window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      if (isDarkMode) {
        document.body.classList.add('dark-mode');
        toggle.checked = true;
        chrome.storage.local.set({ darkMode: true });
      }
    });

    // Toggle dark mode
    toggle.addEventListener('change', (event) => {
      if (event.target.checked) {
        document.body.classList.add('dark-mode');
        chrome.storage.local.set({ darkMode: true });
      } else {
        document.body.classList.remove('dark-mode');
        chrome.storage.local.set({ darkMode: false });
      }
    });
  }

  handleResize() {
    // Adjust layout based on current width
    const width = document.body.clientWidth;
    const colorLegend = document.getElementById('colorLegend');
    
    if (width < 400) {
      colorLegend.style.gridTemplateColumns = '1fr';
    } else if (width < 500) {
      colorLegend.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else {
      colorLegend.style.gridTemplateColumns = 'repeat(3, 1fr)';
    }
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
    this.updateDetails({ aiMode: 'Processing...', highlightCount: 0, textLength: '--' });

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
      const aiModeDisplay = response.aiUsed === 'local' ? 'Chrome AI' : 'Cloud API';
      this.showSuccess(
        `Analysis complete! Found ${response.highlightCount} items using ${aiModeDisplay}. ` +
        `Hover over highlighted text to see details.`
      );
      
      this.updateDetails({
        aiMode: aiModeDisplay,
        highlightCount: response.highlightCount,
        textLength: this.formatTextLength(response.textLength)
      });
    } else {
      this.handleAnalysisError(response.error, response.details);
    }
  }

  formatTextLength(length) {
    if (length < 1000) return `${length} chars`;
    return `${(length / 1000).toFixed(1)}k chars`;
  }

  handleAnalysisError(error, details = {}) {
    let errorMessage = 'Analysis failed: ';
    
    // Specific error handling
    if (error.includes('No text content') || error.includes('No sufficient text')) {
      errorMessage += 'No readable text found on this page. Try a different website.';
    } else if (error.includes('API key') || error.includes('401')) {
      errorMessage += 'Invalid or missing Gemini API key. Please check your API key.';
    } else if (error.includes('Network') || error.includes('fetch')) {
      errorMessage += 'Network error. Check your internet connection.';
    } else if (error.includes('quota') || error.includes('limit') || error.includes('429')) {
      errorMessage += 'API quota exceeded. Try again later or check your API limits.';
    } else if (error.includes('Local AI not available')) {
      errorMessage += 'Chrome\'s built-in AI is not available. Using cloud API requires a valid API key.';
    } else if (error.includes('404') || error.includes('model')) {
      errorMessage += 'API model error. The extension needs to be updated.';
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
          aiMode: '--',
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
    document.getElementById('aiModeValue').textContent = aiMode;
    document.getElementById('highlightCountValue').textContent = highlightCount;
    if (textLength) {
      document.getElementById('textLengthValue').textContent = textLength;
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

    // Initial resize handling
    this.handleResize();
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
