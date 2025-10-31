// Enable side panel for all sites
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.log('Error setting side panel behavior:', error));

// Optional: Open side panel automatically on certain sites
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
