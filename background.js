// Enable side panel for all sites
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.log('Error setting side panel behavior:', error));

// Set side panel options for valid tabs
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    // Enable side panel for http/https pages
    if (tab.url.startsWith('http')) {
      chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true
      });
    }
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Highlighter Pro installed');
  
  // Set default settings without using window object
  chrome.storage.local.get(['darkMode'], (result) => {
    if (result.darkMode === undefined) {
      // Default to light mode since we can't detect system preference in service worker
      chrome.storage.local.set({ darkMode: false });
    }
  });
});

// Handle runtime errors
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ERROR_REPORT') {
    console.error('Extension error:', request.error);
  }
});
