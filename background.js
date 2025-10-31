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
  
  // Set default settings
  chrome.storage.local.get(['darkMode'], (result) => {
    if (result.darkMode === undefined) {
      // Default to system preference
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      chrome.storage.local.set({ darkMode: isSystemDark });
    }
  });
});
