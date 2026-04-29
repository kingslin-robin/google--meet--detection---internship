// background.js - Google Chat Huddle Recorder with auto-download on leave

let currentRecordingTab = null;
let isAutoRecording = false;
let activeRecorderTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📨 Background received:", message.action);
    
    const handleAsync = async () => {
        try {
            // Get current tab ID for iframe contexts
            if (message.action === "getCurrentTabId") {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    sendResponse({ tabId: tab?.id || null });
                } catch (error) {
                    console.error("❌ Error getting tab ID:", error);
                    sendResponse({ tabId: null });
                }
                return;
            }

            // Iframe ready for recording
            if (message.action === "iframeReady") {
                console.log("🎯 Iframe reported ready for recording");
                const service = message.service;
                const tabId = message.tabId;
                
                await chrome.storage.local.set({ 
                    [`iframeReady_${tabId}`]: true,
                    currentMeetingTab: tabId,
                    currentService: service
                });
                
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const autoRecordEnabled = result.autoRecordPermissions?.[service] || false;
                
                if (autoRecordEnabled) {
                    console.log("🎬 Auto-record enabled - starting recording from iframe");
                    setTimeout(async () => {
                        await startRecordingForTab(tabId, service, true);
                    }, 2000);
                }
                
                sendResponse({ success: true });
                return;
            }

            // Start recording request
            if (message.action === "startRecording") {
                const tabId = message.tabId;
                const service = message.service;
                const isAuto = message.isAuto || false;
                
                const response = await startRecordingForTab(tabId, service, isAuto);
                sendResponse(response);
                return;
            }

            // Manual start from popup
            if (message.action === "manualStartRecording") {
                console.log("🎬 Manual recording requested from popup");
                const tabId = message.tabId;
                const service = message.service;
                const response = await startRecordingForTab(tabId, service, false);
                sendResponse(response);
                return;
            }

            // Stop recording when meeting ends
            if (message.action === "stopRecordingOnMeetingEnd") {
                console.log("🛑 Meeting ended - stopping recording");
                await stopRecordingAndDownload();
                sendResponse({ success: true });
                return;
            }

            // Manual stop from popup
            if (message.action === "manualStopRecording") {
                console.log("🛑 Manual stop requested");
                await stopRecordingAndDownload();
                sendResponse({ success: true });
                return;
            }

            // Get recording status
            if (message.action === "getRecordingStatus") {
                const result = await chrome.storage.local.get(['isRecording', 'recordingTime']);
                sendResponse({ 
                    isRecording: result.isRecording || false, 
                    recordingTime: result.recordingTime || "00:00" 
                });
                return;
            }

            // Update timer
            if (message.action === "updateTimer") {
                await chrome.storage.local.set({ recordingTime: message.time });
                sendResponse({ success: true });
                return;
            }

            // Grant auto-record permission
            if (message.action === "grantAutoRecordPermission") {
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const permissions = result.autoRecordPermissions || {};
                permissions[message.service] = true;
                await chrome.storage.local.set({ autoRecordPermissions: permissions });
                sendResponse({ success: true });
                return;
            }

            // Revoke auto-record permission
            if (message.action === "revokeAutoRecordPermission") {
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const permissions = result.autoRecordPermissions || {};
                permissions[message.service] = false;
                await chrome.storage.local.set({ autoRecordPermissions: permissions });
                sendResponse({ success: true });
                return;
            }

            sendResponse({ success: true });
            
        } catch (error) {
            console.error("❌ Error handling message:", error);
            sendResponse({ success: false, error: error.message });
        }
    };

    handleAsync();
    return true;
});

async function startRecordingForTab(tabId, service, isAuto) {
    console.log(`🎬 Starting ${isAuto ? 'AUTO' : 'MANUAL'} recording for ${service}, tab:`, tabId);
    
    if (activeRecorderTabId) {
        // Check if the existing recorder is still alive
        try {
            await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(activeRecorderTabId, { action: "ping" }, (response) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(response);
                });
            });
            console.log("✅ Using existing recorder tab");
            
            // Send start command to existing recorder
            const result = await new Promise((resolve) => {
                chrome.tabs.sendMessage(activeRecorderTabId, { 
                    action: "startRecording", 
                    tabId: tabId,
                    service: service,
                    isAuto: isAuto
                }, (response) => {
                    if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
                    else resolve(response);
                });
            });
            
            if (result && result.success) {
                currentRecordingTab = tabId;
                isAutoRecording = isAuto;
                return { success: true };
            }
        } catch (err) {
            console.log("⚠️ Existing recorder not responding:", err.message);
            activeRecorderTabId = null;
        }
    }

    // Create new recorder tab
    try {
        // Activate the target tab briefly
        await chrome.tabs.update(tabId, { active: true });
        
        // Create recorder tab (hidden)
        const recorderTab = await new Promise((resolve, reject) => {
            chrome.tabs.create({
                url: chrome.runtime.getURL("recorder.html"),
                active: false
            }, (tab) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(tab);
            });
        });
        
        activeRecorderTabId = recorderTab.id;
        
        // Wait for recorder to load and send start command with retry
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 800));
            attempts++;
            
            try {
                const result = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(recorderTab.id, { 
                        action: "startRecording", 
                        tabId: tabId,
                        service: service,
                        isAuto: isAuto
                    }, (response) => {
                        if (chrome.runtime.lastError) resolve({ success: false });
                        else resolve(response);
                    });
                });
                
                if (result && result.success) {
                    currentRecordingTab = tabId;
                    isAutoRecording = isAuto;
                    console.log("✅ Recording started successfully");
                    return { success: true };
                }
            } catch (err) {
                console.log(`Attempt ${attempts + 1} failed, retrying...`);
            }
        }
        
        // Clean up on failure
        await chrome.tabs.remove(recorderTab.id);
        activeRecorderTabId = null;
        return { success: false, error: "Recorder failed to initialize" };
        
    } catch (error) {
        console.error("❌ Failed to start recording:", error);
        activeRecorderTabId = null;
        return { success: false, error: error.message };
    }
}

async function stopRecordingAndDownload() {
    console.log("🛑 Stopping recording and downloading...");
    
    if (activeRecorderTabId) {
        try {
            await new Promise((resolve) => {
                chrome.tabs.sendMessage(activeRecorderTabId, { action: "stopRecording" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log("⚠️ Recorder not responding");
                        resolve(null);
                    } else {
                        resolve(response);
                    }
                });
            });
        } catch (err) {
            console.log("⚠️ Error sending stop message:", err);
        }
        
        // Close recorder tab after a delay
        setTimeout(async () => {
            try {
                await chrome.tabs.remove(activeRecorderTabId);
            } catch (e) {}
            activeRecorderTabId = null;
        }, 2000);
    }
    
    await chrome.storage.local.remove(['isRecording', 'recordingTime']);
    currentRecordingTab = null;
    isAutoRecording = false;
}

// Detect Google Chat Huddle tabs
chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.url && (tab.url.includes('chat.google.com') || tab.url.includes('meet.google.com'))) {
        if (tab.url.includes('huddle') || tab.url.includes('frame')) {
            console.log("🎯 New Google Chat Huddle detected!");
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const result = await chrome.storage.local.get(['autoRecordPermissions']);
            const autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
            
            if (autoRecordEnabled) {
                console.log("🎬 Auto-recording huddle");
                await startRecordingForTab(tab.id, 'gchat', true);
            }
        }
    }
});

// Listen for tab updates (when a page becomes a huddle)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url && (changeInfo.url.includes('huddle') || changeInfo.url.includes('frame'))) {
        console.log("🎯 Tab updated to huddle:", tabId);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const result = await chrome.storage.local.get(['autoRecordPermissions']);
        const autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
        
        if (autoRecordEnabled && !currentRecordingTab) {
            console.log("🎬 Auto-recording huddle from update");
            await startRecordingForTab(tabId, 'gchat', true);
        }
    }
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (currentRecordingTab === tabId) {
        console.log("📞 Meeting tab closed - stopping recording");
        await stopRecordingAndDownload();
    }
});

console.log("✅ Background service worker loaded - Google Chat Huddle Ready");