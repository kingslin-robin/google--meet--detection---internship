// BACKGROUND - Message routing, Tab management, Permission handling, Recording coordination, Auto-recording logic

let userPermissionGranted = false;
let currentRecordingTab = null;
let isAutoRecording = false;
let autoStartTimeout = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for Meet tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Function to close recorder tabs from background
function closeAllRecorderTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length === 0) {
                console.log("✅ No recorder tabs found to close");
                resolve();
                return;
            }
            
            let closedCount = 0;
            tabs.forEach(tab => {
                chrome.tabs.remove(tab.id, () => {
                    closedCount++;
                    console.log(`✅ Background closed recorder tab: ${tab.id}`);
                    
                    if (closedCount === tabs.length) {
                        console.log("✅ Background: All recorder tabs closed");
                        resolve();
                    }
                });
            });
        });
    });
}

// Proper async message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  // Handle async responses properly
  const handleAsync = async () => {
    try {
      if (message.action === "grantAutoRecordPermission") {
        userPermissionGranted = true;
        await chrome.storage.local.set({ autoRecordPermission: true });
        notifyAllMeetTabs(true);
        console.log("✅ Auto record permission granted");
        sendResponse({ success: true });
      }
      
      else if (message.action === "revokeAutoRecordPermission") {
        userPermissionGranted = false;
        await chrome.storage.local.set({ autoRecordPermission: false });
        notifyAllMeetTabs(false);
        console.log("❌ Auto record permission revoked");
        sendResponse({ success: true });
      }

      // Debug endpoint to check background state
      else if (message.action === "getBackgroundState") {
        console.log("🔍 Background state requested:");
        console.log("- currentRecordingTab:", currentRecordingTab);
        console.log("- isAutoRecording:", isAutoRecording);
        console.log("- userPermissionGranted:", userPermissionGranted);
    
        sendResponse({
          currentRecordingTab: currentRecordingTab,
          isAutoRecording: isAutoRecording,
          userPermissionGranted: userPermissionGranted
        });
      }

      // Handle refreshExtensionState message
      else if (message.action === "refreshExtensionState") {
        console.log("🔄 Refreshing extension state in background");
    
        // Close recorder tabs first
        await closeAllRecorderTabs();
    
        currentRecordingTab = null;
        isAutoRecording = false;
    
        if (autoStartTimeout) {
          clearTimeout(autoStartTimeout);
          autoStartTimeout = null;
        }
    
        sendResponse({ success: true });
      }
      
      // Auto start recording with proper state management
      else if (message.action === "autoStartRecording") {
        console.log("🎬 Auto-start recording requested from tab:", sender.tab?.id);
  
        // Clear any pending auto-start
        if (autoStartTimeout) {
          clearTimeout(autoStartTimeout);
          autoStartTimeout = null;
        }
  
        const handleAutoStart = async () => {
          try {
            if (!sender.tab?.id) {
              console.log("❌ No sender tab ID");
              sendResponse({ success: false, reason: "no_tab_id" });
              return;
            }
      
            if (!userPermissionGranted) {
              console.log("❌ Auto recording denied - no permission");
              sendResponse({ success: false, reason: "no_permission" });
              return;
            }
      
            // Aggressive recovery: Always reset states before auto-start
            console.log("🔄 Resetting states before auto-start...");
            currentRecordingTab = null;
            isAutoRecording = false;
      
            // Clear storage to ensure clean state
            await chrome.storage.local.set({ 
              isRecording: false,
              recordingStoppedByTabClose: true 
            });
      
            console.log("✅ Starting auto recording for tab:", sender.tab.id);
            currentRecordingTab = sender.tab.id;
            isAutoRecording = true;
      
            // Start recording with 2 second delay
            setTimeout(() => {
              startRecordingForTab(sender.tab.id);
            }, 2000);
      
            sendResponse({ success: true });
      
          } catch (error) {
            console.error("❌ Error in autoStartRecording:", error);
            currentRecordingTab = null;
            isAutoRecording = false;
            sendResponse({ success: false, error: error.message });
          }
        };
  
        // Start immediately (no additional delay)
        handleAutoStart();
        return true;
      }

      else if (message.action === "autoStopRecording") {
        console.log("🛑 Auto stop recording requested");
        stopAllRecordings();
        sendResponse({ success: true });
      }

      // Route recording completion to Meet tab
      else if (message.action === "recordingCompleted") {
        currentRecordingTab = null;
        isAutoRecording = false;
        
        chrome.tabs.query({ url: "https://*.meet.google.com/*" }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: "recordingCompleted" });
          });
        });

        setTimeout(() => {
          closeAllRecorderTabs();
        }, 1000);

        sendResponse({ success: true });
      }

      else if (message.action === "recorderFailed") {
  console.error("❌ Recorder tab reported failure:", message.error);
  
  // Reset states since recording failed
  currentRecordingTab = null;
  isAutoRecording = false;
  
  // Clear storage to reflect actual state
  await chrome.storage.local.set({ 
    isRecording: false,
    recordingStoppedByTabClose: true 
  });
  
  console.log("🔄 Background: Reset states after recorder failure");
  
  sendResponse({ success: true });
}
      
      else if (message.action === "checkMeetingStatus") {
        chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
      }

      // Close recorder tab for auto mode
      else if (message.action === "closeRecorderTab") {
        console.log("🛑 Closing recorder tab for auto mode");
        closeAllRecorderTabs();
        sendResponse({ success: true });
      }

      // Stop recording when meeting ends
      else if (message.action === "stopRecordingOnMeetingEnd") {
        console.log("🛑 Meeting ended - AUTO-DOWNLOADING recording");
        await stopRecordingOnMeetingEnd();
        sendResponse({ success: true });
      }

      // Route status messages to active Meet tab
      else if (message.action === "showMeetStatus" || message.action === "updateMeetTimer") {
        chrome.tabs.query({ url: "https://*.meet.google.com/*" }, (tabs) => {
          tabs.forEach(tab => {
            if (tab.id !== sender.tab?.id) {
                chrome.tabs.sendMessage(tab.id, message);
            }
          });
        });
        sendResponse({ success: true });
      }

      else if (message.action === "healthCheck") {
        console.log("❤️ Background health check received");
        sendResponse({ status: "healthy", service: "background" });
      }

      else if (message.action === "cleanupFailedRecorders") {
        console.log("🧹 Manual cleanup of failed recorders requested");
        detectAndCleanupFailedRecorderTabs().then(() => {
          sendResponse({ success: true });
        });
        return true;
      }
      
      else {
        sendResponse({ success: false, reason: "unknown_action" });
      }
    } catch (error) {
      console.error("❌ Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  };

  handleAsync();
  return true; 
});

// Separate function for meeting end handling
async function stopRecordingOnMeetingEnd() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
      if (tabs.length > 0) {
        let completed = 0;
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            action: "stopRecording",
            forceAutoDownload: true 
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.log("⚠️ Recorder tab not responding");
            } else {
              console.log("✅ Auto-download command sent");
            }
            completed++;
            if (completed === tabs.length) {
              currentRecordingTab = null;
              isAutoRecording = false;
              resolve();
            }
          });
        });
      } else {
        console.log("⚠️ No recorder tabs found");
        currentRecordingTab = null;
        isAutoRecording = false;
        resolve();
      }
    });
  });
}

// Close all recorder tabs
function closeAllRecorderTabs() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
      console.log("✅ Stop message sent to recorder tab");
    });
  });
  currentRecordingTab = null;
  isAutoRecording = false;
}

// Notify all Meet tabs about permission change
function notifyAllMeetTabs(enabled) {
  chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

function detectAndCleanupFailedRecorderTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
      if (tabs.length === 0) {
        console.log("✅ No recorder tabs to check");
        resolve();
        return;
      }

      let checkedCount = 0;
      let failedTabs = [];

      tabs.forEach(tab => {
        // Send a health check to each recorder tab
        chrome.tabs.sendMessage(tab.id, { action: "healthCheck" }, (response) => {
          checkedCount++;
          
          if (chrome.runtime.lastError || !response) {
            console.log(`❌ Recorder tab ${tab.id} is unresponsive - marking for closure`);
            failedTabs.push(tab.id);
          } else if (response.status === "healthy") {
            console.log(`✅ Recorder tab ${tab.id} is healthy`);
          }

          // When all tabs are checked, close the failed ones
          if (checkedCount === tabs.length) {
            if (failedTabs.length > 0) {
              console.log(`🛑 Closing ${failedTabs.length} failed recorder tabs`);
              
              failedTabs.forEach(tabId => {
                chrome.tabs.remove(tabId, () => {
                  console.log(`✅ Closed failed recorder tab: ${tabId}`);
                });
              });

              // Refresh meeting state after closing failed tabs
              refreshMeetingState();
            } else {
              console.log("✅ All recorder tabs are healthy");
            }
            resolve();
          }
        });
      });

      // Fallback: If no responses within 3 seconds, assume all are failed
      setTimeout(() => {
        if (checkedCount < tabs.length) {
          console.log("⏰ Health check timeout - assuming unresponsive tabs are failed");
          
          tabs.forEach(tab => {
            if (!failedTabs.includes(tab.id)) {
              failedTabs.push(tab.id);
            }
          });

          if (failedTabs.length > 0) {
            failedTabs.forEach(tabId => {
              chrome.tabs.remove(tabId, () => {
                console.log(`✅ Closed unresponsive recorder tab: ${tabId}`);
              });
            });
            refreshMeetingState();
          }
          resolve();
        }
      }, 3000);
    });
  });
}

// Function to refresh meeting state globally
function refreshMeetingState() {
  console.log("🔄 Refreshing global meeting state after cleanup");
  
  // Reset background states
  currentRecordingTab = null;
  isAutoRecording = false;
  
  if (autoStartTimeout) {
    clearTimeout(autoStartTimeout);
    autoStartTimeout = null;
  }

  // Clear storage
  chrome.storage.local.set({ 
    isRecording: false,
    recordingStoppedByTabClose: true 
  });

  // Notify all Meet tabs to reset their states
  chrome.tabs.query({ url: "https://*.meet.google.com/*" }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { 
        action: "forceResetAndRetry" 
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`⚠️ Could not notify Meet tab ${tab.id}:`, chrome.runtime.lastError.message);
        } else {
          console.log(`✅ Notified Meet tab ${tab.id} to reset state`);
        }
      });
    });
  });

  console.log("✅ Global meeting state refreshed");
}

// Improved recording start with activeTab validation
function startRecordingForTab(tabId) {
  console.log("🎬 Creating recorder tab for auto recording...");
  
  // Validate the tab exists and is a Meet tab
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      console.error("❌ Source tab not found or inaccessible:", chrome.runtime.lastError);
      currentRecordingTab = null;
      isAutoRecording = false;
      return;
    }
    
    if (!isMeetTab(tab.url)) {
      console.error("❌ Source tab is not a Google Meet tab:", tab.url);
      currentRecordingTab = null;
      isAutoRecording = false;
      return;
    }
    
    chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (recorderTab) => {
      console.log("✅ Recorder tab created:", recorderTab.id);
      
      const attemptStart = (retry = 0) => {
        console.log(`🔄 Attempting to start recording (attempt ${retry + 1})...`);
        
        chrome.tabs.sendMessage(recorderTab.id, { 
          action: "startRecording", 
          tabId: tabId, 
          autoRecord: true 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`⚠️ Recorder not ready: ${chrome.runtime.lastError.message}`);
            if (retry < 3) {
              console.log(`🔄 Retrying in 1.5 seconds... (${retry + 1}/3)`);
              setTimeout(() => attemptStart(retry + 1), 1500);
            } else {
              console.error("❌ Failed to start recording after 3 attempts");
              currentRecordingTab = null;
              isAutoRecording = false;
            }
          } else {            
            currentRecordingTab = tabId;
            isAutoRecording = true;
          }
        });
      };
      
      // Wait 2 seconds before first attempt
      setTimeout(() => attemptStart(), 2000);
    });
  });
}

function stopAllRecordings() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Recorder tab not responding");
          } else {
            console.log("✅ Stop message sent to recorder tab");
          }
        });
      });
    } else {
      console.log("⚠️ No recorder tabs found");
    }
  });
  currentRecordingTab = null;
  isAutoRecording = false;
}

// Stop recording if source tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) {
    console.log("❌ Source tab closed - stopping recording");
    stopAllRecordings();
  }
});

// Keep service worker alive
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 20000)
