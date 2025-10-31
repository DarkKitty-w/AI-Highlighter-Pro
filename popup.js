document.addEventListener('DOMContentLoaded', function() {
  // Load saved API key
  chrome.storage.local.get(['geminiApiKey'], function(result) {
    if (result.geminiApiKey) {
      document.getElementById('apiKey').value = result.geminiApiKey;
    }
  });

  // Highlight button
  document.getElementById('highlightBtn').addEventListener('click', function() {
    const apiKey = document.getElementById('apiKey').value;
    const query = document.getElementById('query').value;

    if (!query) {
      showStatus('Please enter what to highlight', 'error');
      return;
    }

    // Save API key
    chrome.storage.local.set({ geminiApiKey: apiKey });

    // Get active tab
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'analyzeAndHighlight',
        query: query,
        apiKey: apiKey
      }, function(response) {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        } else if (response && response.success) {
          showStatus(`Highlighted ${response.highlightCount} items using ${response.aiUsed}`, 'success');
        } else {
          showStatus('Analysis completed', 'success');
        }
      });
    });
  });

  // Clear button
  document.getElementById('clearBtn').addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'clearHighlights'
      });
    });
    showStatus('Highlights cleared', 'success');
  });

  function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    setTimeout(() => statusDiv.textContent = '', 3000);
  }
});
