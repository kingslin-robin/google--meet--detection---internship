// background.js - Complete updated version with iframe recording support

let currentRecordingTab = null;
let isAutoRecording = false;

// Add this to background.js - modify the existing message handlers

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📨 Background received:", message.action);
    
    const handleAsync = async () => {
        try {
            // Handle iframe detection and recording
            if (message.action === "iframeReady") {
                console.log("🎯 Iframe reported ready for recording");
                const service = message.service;
                const tabId = message.tabId;
                
                // Store that this tab's iframe is ready
                await chrome.storage.local.set({ 
                    [`iframeReady_${tabId}`]: true,
                    currentMeetingTab: tabId,
                    currentService: service
                });
                
                // Check if auto-record is enabled for this service
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const autoRecordEnabled = result.autoRecordPermissions?.[service] || false;
                
                if (autoRecordEnabled) {
                    console.log("🎬 Auto-record enabled - starting recording from iframe");
                    // Wait a moment for meeting to fully load
                    setTimeout(async () => {
                        const response = await startRecordingFromIframe(tabId, service);
                        if (response && response.success) {
                            console.log("✅ Auto-recording started successfully from iframe");
                        } else {
                            console.log("❌ Failed to start auto-recording from iframe");
                        }
                    }, 3000);
                }
                
                sendResponse({ success: true });
                return;
            }

            // Handle recording start from iframe
            if (message.action === "startRecordingFromIframe") {
                console.log("🎬 Starting recording from iframe request");
                const tabId = message.tabId;
                const service = message.service;
                const response = await startRecordingFromIframe(tabId, service);
                sendResponse(response);
                return;
            }

            // Handle auto start recording from content script
            if (message.action === "autoStartRecording") {
                console.log("🎬 Auto-start recording requested from content script");
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.id) {
                    const service = detectServiceFromUrl(tab.url);
                    if (service) {
                        const response = await startRecordingFromIframe(tab.id, service);
                        sendResponse(response);
                    } else {
                        sendResponse({ success: false, error: "No meeting service detected" });
                    }
                } else {
                    sendResponse({ success: false, error: "No active tab found" });
                }
                return;
            }

            // Handle stop recording on meeting end
            if (message.action === "stopRecordingOnMeetingEnd") {
                console.log("🛑 Meeting ended - stopping recording");
                await stopRecordingAndCleanup();
                sendResponse({ success: true });
                return;
            }

            // Handle grant auto record permission
            if (message.action === "grantAutoRecordPermission") {
                console.log("✅ Granting auto-record permission for:", message.service);
                // Auto-record permission is already stored, just confirm
                sendResponse({ success: true });
                return;
            }

            // Handle revoke auto record permission
            if (message.action === "revokeAutoRecordPermission") {
                console.log("❌ Revoking auto-record permission for:", message.service);
                sendResponse({ success: true });
                return;
            }

            // Default response for unhandled actions
            sendResponse({ success: true, message: "Action received" });
            
        } catch (error) {
            console.error("❌ Error handling message:", error);
            sendResponse({ success: false, error: error.message });
        }
    };

    handleAsync().then(sendResponse);
    return true;
});

// New function to start recording from iframe
async function startRecordingFromIframe(tabId, service) {
    console.log(`🎬 Starting recording for ${service} from iframe context, tab:`, tabId);
    
    if (currentRecordingTab && !isAutoRecording) {
        console.log("⚠️ Already recording in tab:", currentRecordingTab);
        return { success: false, error: "Already recording" };
    }

    currentRecordingTab = tabId;
    isAutoRecording = true;

    try {
        // First check if recorder tab already exists
        const existingTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        
        if (existingTabs.length > 0) {
            console.log("✅ Using existing recorder tab");
            const recorderTab = existingTabs[0];
            
            // Check if the existing recorder tab is responsive
            try {
                await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(recorderTab.id, { 
                        action: "ping"
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(response);
                        }
                    });
                });
                
                // Send start recording message to existing recorder
                await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(recorderTab.id, { 
                        action: "startRecording", 
                        tabId: tabId,
                        autoRecord: true,
                        service: service,
                        isIframe: true
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    });
                });
                
                console.log("✅ Recording started successfully using existing recorder tab");
                return { success: true };
                
            } catch (err) {
                console.log("⚠️ Existing recorder not responding, creating new one:", err.message);
                // Close the non-responsive tab
                await chrome.tabs.remove(recorderTab.id);
            }
        }

        // Create new recorder tab
        const recorderTab = await new Promise((resolve, reject) => {
            chrome.tabs.create({
                url: chrome.runtime.getURL("recorder.html"),
                active: false
            }, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(tab);
                }
            });
        });
        
        console.log("✅ Recorder tab opened:", recorderTab.id);
        
        // Wait for recorder tab to load and start recording with retry
        const startResult = await startRecordingWithRetry(recorderTab.id, tabId, service);
        
        if (!startResult.success) {
            // Clean up if failed
            await chrome.tabs.remove(recorderTab.id);
            currentRecordingTab = null;
            isAutoRecording = false;
        }
        
        return startResult;
        
    } catch (error) {
        console.error("❌ Failed to start recording from iframe:", error);
        currentRecordingTab = null;
        isAutoRecording = false;
        return { success: false, error: error.message };
    }
}

// Helper function to start recording with retry logic
async function startRecordingWithRetry(recorderTabId, targetTabId, service, maxRetries = 5) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`🔄 Attempting to start recording (attempt ${attempt + 1}/${maxRetries})...`);
        
        try {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Increasing delay
            
            const response = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(recorderTabId, { 
                    action: "startRecording", 
                    tabId: targetTabId,
                    autoRecord: true,
                    service: service,
                    isIframe: true
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
            
            console.log("✅ Recording started successfully from iframe");
            return { success: true };
            
        } catch (error) {
            console.log(`❌ Attempt ${attempt + 1} failed:`, error.message);
            
            if (attempt === maxRetries - 1) {
                console.error("❌ Failed to start recording after all attempts");
                return { success: false, error: "Recorder tab not ready after multiple attempts" };
            }
        }
    }
    
    return { success: false, error: "Max retries exceeded" };
}

// Helper function to stop recording and cleanup
async function stopRecordingAndCleanup() {
    console.log("🛑 Stopping recording and cleaning up...");
    
    try {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        
        if (tabs.length > 0) {
            for (const tab of tabs) {
                try {
                    await new Promise((resolve, reject) => {
                        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }, (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                resolve(response);
                            }
                        });
                    });
                    console.log("✅ Stop recording message sent to recorder tab:", tab.id);
                    
                    // Close the recorder tab after a delay
                    setTimeout(() => {
                        chrome.tabs.remove(tab.id).catch(() => {});
                    }, 2000);
                    
                } catch (err) {
                    console.log("⚠️ Could not send stop message to recorder tab:", err.message);
                    // Force close if not responding
                    await chrome.tabs.remove(tab.id);
                }
            }
        }
        
        // Clear recording state
        await chrome.storage.local.remove(['isRecording', 'recordingTime']);
        currentRecordingTab = null;
        isAutoRecording = false;
        
    } catch (error) {
        console.error("❌ Error during stop recording cleanup:", error);
    }
}

// Helper function to detect service from URL
function detectServiceFromUrl(url) {
    if (!url) return null;
    if (url.includes('meet.google.com')) return 'gmeet';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
    return null;
}

// Listen for tab closure to clean up recording
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    console.log("Tab closed:", tabId);
    
    if (currentRecordingTab === tabId) {
        console.log("🎬 Recording tab was closed - cleaning up");
        await stopRecordingAndCleanup();
    }
    
    // Check if it was a meeting tab
    const result = await chrome.storage.local.get(['currentMeetingTab']);
    if (result.currentMeetingTab === tabId) {
        console.log("📞 Meeting tab closed - stopping any active recording");
        await stopRecordingAndCleanup();
        await chrome.storage.local.remove(['currentMeetingTab', 'currentService']);
    }
});

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("Extension installed/updated:", details.reason);
    
    // Initialize storage if needed
    const result = await chrome.storage.local.get(['autoRecordPermissions']);
    if (!result.autoRecordPermissions) {
        await chrome.storage.local.set({ autoRecordPermissions: {} });
    }
});

// Periodic cleanup of stale recorder tabs
setInterval(async () => {
    try {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        const isRecording = await chrome.storage.local.get(['isRecording']);
        
        // If there are recorder tabs but no recording is active, close them
        if (tabs.length > 0 && !isRecording.isRecording) {
            console.log("🧹 Cleaning up stale recorder tabs");
            for (const tab of tabs) {
                await chrome.tabs.remove(tab.id);
            }
        }
    } catch (error) {
        console.error("Error during cleanup:", error);
    }
}, 60000); // Run every minute