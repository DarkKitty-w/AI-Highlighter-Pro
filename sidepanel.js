class SidePanel {
  constructor() {
    console.log('SidePanel constructor called');
    try {
      this.initializeEventListeners();
      this.loadSavedSettings();
      this.updateLegend(null);
      this.initializeDarkMode();
      console.log('SidePanel initialized successfully');
    } catch (error) {
      console.error('Error in SidePanel constructor:', error);
    }
  }

  initializeEventListeners() {
    console.log('Initializing event listeners...');
    
    const analyzeBtn = document.getElementById('analyzeBtn');
    const clearBtn = document.getElementById('clearBtn');
    const queryInput = document.getElementById('query');
    const darkModeToggle = document.getElementById('darkModeToggle');

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => {
        console.log('Analyze button clicked');
        this.handleAnalyze();
      });
    } else {
      console.error('Analyze button not found');
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        console.log('Clear button clicked');
        this.handleClear();
      });
    } else {
      console.error('Clear button not found');
    }

    if (queryInput) {
      queryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleAnalyze();
        }
      });
    } else {
      console.error('Query input not found');
    }

    if (darkModeToggle) {
      darkModeToggle.addEventListener('change', () => {
        const isDark = darkModeToggle.checked;
        document.body.classList.toggle('dark-mode', isDark);
        chrome.storage.local.set({ darkMode: isDark });
      });
    }

    // Écouteur pour les messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('Message received:', request.type);
      if (request.type === 'ANALYSIS_PROGRESS') {
        this.updateStatus(request.message, 'info');
      }
      
      if (request.type === 'UPDATE_LEGEND') {
        this.updateLegend(request.payload);
      }
      
      if (request.type === 'CLEAR_LEGEND') {
        this.updateLegend(null);
      }
    });

    window.addEventListener('resize', () => {
      this.handleResize();
    });
    
    this.handleResize();
  }

  initializeDarkMode() {
    const toggle = document.getElementById('darkModeToggle');
    
    chrome.storage.local.get(['darkMode'], (result) => {
      if (result.darkMode === undefined) {
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        chrome.storage.local.set({ darkMode: isSystemDark });
        document.body.classList.toggle('dark-mode', isSystemDark);
        if (toggle) toggle.checked = isSystemDark;
      } else {
        document.body.classList.toggle('dark-mode', result.darkMode);
        if (toggle) toggle.checked = result.darkMode;
      }
    });
  }

  async handleAnalyze() {
    console.log('handleAnalyze called');
    const query = document.getElementById('query').value;
    const apiKey = document.getElementById('apiKey').value;

    if (!query) {
      this.updateStatus('Please enter a query.', 'error');
      return;
    }
    if (!apiKey) {
      this.updateStatus('Please enter your Gemini API key.', 'error');
      return;
    }

    this.saveSettings(apiKey, query);
    this.setLoading(true);
    this.updateStatus('Checking current page...', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      console.log('Current tab:', tab);
      
      if (!tab) {
        throw new Error('No active tab found.');
      }
      
      if (!tab.id) {
        throw new Error('Tab ID not available.');
      }
      
      // VÉRIFICATION SIMPLIFIÉE - CORRECTION PRINCIPALE
      if (!tab.url) {
        throw new Error('Cannot analyze empty tab.');
      }
      
      // Autoriser http, https, file, et autres protocoles non-Chrome
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || 
          tab.url.startsWith('edge://') || tab.url.startsWith('about:') || 
          tab.url.startsWith('moz-extension://')) {
        throw new Error('Cannot analyze browser internal pages. Please navigate to a regular website.');
      }
      
      this.updateStatus('Sending request to content script...', 'info');
      
      // Test if content script is responsive
      try {
        const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        console.log('Content script ping response:', pingResponse);
      } catch (pingError) {
        console.log('Ping failed, but continuing anyway:', pingError);
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'analyzeAndHighlight',
        query: query,
        apiKey: apiKey
      });

      console.log('Response from content script:', response);

      if (response && response.success) {
        this.updateStatus(`Analysis complete! Found ${response.highlightCount} items.`, 'success');
        this.updateStats(response.aiUsed, response.highlightCount, response.textLength);
      } else {
        throw new Error(response.error || 'Unknown error during analysis.');
      }

    } catch (error) {
      console.error('Error in handleAnalyze:', error);
      
      if (error.message.includes('Could not establish connection')) {
        this.updateStatus('Error: Content script not loaded. Please refresh the page and try again.', 'error');
      } else if (error.message.includes('Cannot analyze browser internal pages')) {
        this.updateStatus('Error: ' + error.message, 'error');
      } else if (error.message.includes('Cannot analyze empty tab')) {
        this.updateStatus('Error: ' + error.message, 'error');
      } else {
        this.updateStatus(`Error: ${error.message}`, 'error');
      }
      
      this.updateStats('--', 0, '--');
    } finally {
      this.setLoading(false);
    }
  }

  async handleClear() {
    console.log('handleClear called');
    this.setLoading(true);
    this.updateStatus('Clearing highlights...', 'info');
    
    this.updateLegend(null);
    this.updateStats('--', 0, '--');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
        this.updateStatus('Highlights cleared.', 'info');
      } else {
        this.updateStatus('No valid page to clear.', 'info');
      }
    } catch (error) {
      console.error('Error in handleClear:', error);
      this.updateStatus('Ready.', 'info');
    } finally {
      this.setLoading(false);
    }
  }

  setLoading(isLoading) {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const clearBtn = document.getElementById('clearBtn');
    
    if (analyzeBtn) {
      analyzeBtn.disabled = isLoading;
      analyzeBtn.textContent = isLoading ? 'Analyzing...' : 'Analyze & Highlight';
    }
    
    if (clearBtn) clearBtn.disabled = isLoading;
    
    if (isLoading) {
      document.body.classList.add('loading');
    } else {
      document.body.classList.remove('loading');
    }
  }

  updateStatus(message, type = 'info') {
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `status-message status-${type}`;
    }
  }

  updateStats(aiMode, highlightCount, textLength) {
    const aiModeElement = document.getElementById('aiModeValue');
    const highlightCountElement = document.getElementById('highlightCountValue');
    const textLengthElement = document.getElementById('textLengthValue');
    
    if (aiModeElement) aiModeElement.textContent = aiMode;
    if (highlightCountElement) highlightCountElement.textContent = highlightCount;
    if (textLengthElement) {
      textLengthElement.textContent = textLength > 1000 ? 
        `${(textLength / 1000).toFixed(1)}k` : textLength;
    }
  }

  handleResize() {
    const panel = document.body;
    if (panel) {
      const isCompact = panel.clientWidth < 320;
      panel.classList.toggle('compact', isCompact);
    }
  }

  updateLegend(colorsMap) {
    const legendElement = document.getElementById('colorLegend');
    if (!legendElement) return;
    
    legendElement.innerHTML = '';

    if (!colorsMap || Object.keys(colorsMap).length === 0) {
      // Afficher un message quand il n'y a pas de légende
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'color-item';
      emptyMessage.textContent = 'No highlights yet';
      emptyMessage.style.opacity = '0.6';
      emptyMessage.style.fontStyle = 'italic';
      legendElement.appendChild(emptyMessage);
      return;
    }

    Object.entries(colorsMap).forEach(([category, color]) => {
      const colorItem = document.createElement('div');
      colorItem.className = 'color-item';
      
      const label = category.charAt(0).toUpperCase() + category.slice(1);
      
      colorItem.innerHTML = `
        <div class="color-swatch" style="background-color: ${color}"></div>
        <span>${label}</span>
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

// Initialisation avec gestion d'erreur
console.log('Starting SidePanel initialization...');
document.addEventListener('DOMContentLoaded', function() {
  try {
    new SidePanel();
    console.log('SidePanel fully initialized');
  } catch (error) {
    console.error('Failed to initialize SidePanel:', error);
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
      statusElement.textContent = 'Error initializing extension. Please refresh.';
      statusElement.className = 'status-message status-error';
    }
  }
});
