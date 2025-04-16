// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Editor Web Observer extension installed');
});

// Track active tabs
const activeTabs = new Set();

// Create a modal dialog in the page context
const createConfirmDialog = async (tabId, message) => {
  // Inject a content script that shows a confirmation dialog
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (dialogMessage) => {
      return window.confirm(dialogMessage);
    },
    args: [message]
  });
  
  // Return the result of the confirmation
  return results[0].result;
};

// Handle extension button click
chrome.action.onClicked.addListener(async (tab) => {
  // Check if already active for this tab
  const isActive = activeTabs.has(tab.id);
  
  try {
    if (isActive) {
      // If already active, ask if they want to deactivate
      const deactivate = await createConfirmDialog(
        tab.id, 
        'AI Editor Web Observer is active on this page. Would you like to deactivate it?'
      );
      
      if (deactivate) {
        // Remove from active tabs
        activeTabs.delete(tab.id);
        
        // Update icon to show inactive state
        chrome.action.setIcon({
          tabId: tab.id,
          path: {
            16: "icons/icon16_inactive.png",
            48: "icons/icon48_inactive.png",
            128: "icons/icon128_inactive.png"
          }
        });
        
        // Send message to content script to deactivate
        chrome.tabs.sendMessage(tab.id, { action: "deactivate" })
          .catch(err => console.error("Error sending deactivation message:", err));
        
        // Notify user
        chrome.tabs.sendMessage(tab.id, { action: "showNotification", message: "AI Editor Web Observer deactivated" })
          .catch(err => console.error("Error showing notification:", err));
      }
    } else {
      // If not active, ask if they want to activate
      const activate = await createConfirmDialog(
        tab.id,
        'Would you like to activate AI Editor Web Observer on this page?\n\nThis will allow observation and modification of page elements.'
      );
      
      if (activate) {
        // Add to active tabs
        activeTabs.add(tab.id);
        
        // Update icon to show active state
        chrome.action.setIcon({
          tabId: tab.id,
          path: {
            16: "icons/icon16.png",
            48: "icons/icon48.png",
            128: "icons/icon128.png"
          }
        });
        
        // Inject content script if not already present
        try {
          // First try to send a message to see if content script is already there
          await chrome.tabs.sendMessage(tab.id, { action: "ping" })
            .catch(async () => {
              // If message fails, content script isn't injected yet, so inject it
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
              });
            });
          
          // Send activation message
          chrome.tabs.sendMessage(tab.id, { action: "activate" });
        } catch (error) {
          console.error("Error injecting or activating content script:", error);
        }
      }
    }
  } catch (error) {
    console.error("Error handling button click:", error);
  }
});

// Handle tab close/navigation to remove from active tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

// Handle navigation (URL change) to deactivate
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && activeTabs.has(tabId)) {
    activeTabs.delete(tabId);
    
    // Update icon to show inactive state
    chrome.action.setIcon({
      tabId: tabId,
      path: {
        16: "icons/icon16_inactive.png",
        48: "icons/icon48_inactive.png",
        128: "icons/icon128_inactive.png"
      }
    });
  }
}); 