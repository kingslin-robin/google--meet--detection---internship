// background.js - Fixed version with Google Chat Huddle popup support and proper tab ID handling

let currentRecordingTab = null;
let isAutoRecording = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📨 Background received:", message.action);
    
    const handleAsync = async () => {
        try {
            // Handle getCurrentTabId request (for iframe contexts)
            if (message.action === "getCurrentTabId") {
                console.log("🔍 Getting current tab ID");
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    console.log("✅ Current tab ID:", tab?.id);
                    sendResponse({ tabId: tab?.id || null });
                } catch (error) {
                    console.error("❌ Error getting tab ID:", error);
                    sendResponse({ tabId: null });
                }
                return;
            }

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

            if (message.action === "startRecordingFromIframe") {
                console.log("🎬 Starting recording from iframe request");
                const tabId = message.tabId;
                const service = message.service;
                const response = await startRecordingFromIframe(tabId, service);
                sendResponse(response);
                return;
            }

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

            if (message.action === "stopRecordingOnMeetingEnd") {
                console.log("🛑 Meeting ended - stopping recording");
                await stopRecordingAndCleanup();
                sendResponse({ success: true });
                return;
            }

            if (message.action === "grantAutoRecordPermission") {
                console.log("✅ Granting auto-record permission for:", message.service);
                sendResponse({ success: true });
                return;
            }

            if (message.action === "revokeAutoRecordPermission") {
                console.log("❌ Revoking auto-record permission for:", message.service);
                sendResponse({ success: true });
                return;
            }

            if (message.action === "manualStartRecording") {
                console.log("🎬 Manual recording requested from popup");
                const tabId = message.tabId;
                const service = message.service;
                const response = await startManualRecording(tabId, service);
                sendResponse(response);
                return;
            }

            sendResponse({ success: true, message: "Action received" });
            
        } catch (error) {
            console.error("❌ Error handling message:", error);
            sendResponse({ success: false, error: error.message });
        }
    };

    handleAsync().then(sendResponse);
    return true;
});

async function startManualRecording(tabId, service) {
    console.log(`🎬 Starting MANUAL recording for ${service}, tab:`, tabId);
    
    if (currentRecordingTab && !isAutoRecording) {
        console.log("⚠️ Already recording in tab:", currentRecordingTab);
        return { success: false, error: "Already recording" };
    }

    currentRecordingTab = tabId;
    isAutoRecording = false;

    try {
        console.log("🔍 Activating target tab...");
        await chrome.tabs.update(tabId, { active: true });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const existingTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        
        if (existingTabs.length > 0) {
            console.log("✅ Found existing recorder tab, checking if responsive...");
            const recorderTab = existingTabs[0];
            
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
                
                console.log("✅ Existing recorder tab is responsive");
                
                await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(recorderTab.id, { 
                        action: "startRecording", 
                        tabId: tabId,
                        autoRecord: false,
                        service: service,
                        isIframe: false
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    });
                });
                
                console.log("✅ Manual recording started successfully using existing recorder tab");
                return { success: true };
                
            } catch (err) {
                console.log("⚠️ Existing recorder not responding, creating new one:", err.message);
                await chrome.tabs.remove(recorderTab.id);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log("🆕 Creating new recorder tab...");
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
        
        const startResult = await startRecordingWithRetry(recorderTab.id, tabId, service, false);
        
        if (!startResult.success) {
            await chrome.tabs.remove(recorderTab.id);
            currentRecordingTab = null;
            isAutoRecording = false;
        }
        
        return startResult;
        
    } catch (error) {
        console.error("❌ Failed to start manual recording:", error);
        currentRecordingTab = null;
        isAutoRecording = false;
        return { success: false, error: error.message };
    }
}

async function startRecordingFromIframe(tabId, service) {
    console.log(`🎬 Starting AUTO recording for ${service} from iframe context, tab:`, tabId);
    
    if (currentRecordingTab && !isAutoRecording) {
        console.log("⚠️ Already recording in tab:", currentRecordingTab);
        return { success: false, error: "Already recording" };
    }

    currentRecordingTab = tabId;
    isAutoRecording = true;

    try {
        console.log("🔍 Activating iframe tab...");
        await chrome.tabs.update(tabId, { active: true });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const existingTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        
        if (existingTabs.length > 0) {
            console.log("✅ Using existing recorder tab for auto recording");
            const recorderTab = existingTabs[0];
            
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
                
                console.log("✅ Auto recording started successfully using existing recorder tab");
                return { success: true };
                
            } catch (err) {
                console.log("⚠️ Existing recorder not responding, creating new one:", err.message);
                await chrome.tabs.remove(recorderTab.id);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

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
        
        console.log("✅ Recorder tab opened for auto recording:", recorderTab.id);
        
        const startResult = await startRecordingWithRetry(recorderTab.id, tabId, service, true);
        
        if (!startResult.success) {
            await chrome.tabs.remove(recorderTab.id);
            currentRecordingTab = null;
            isAutoRecording = false;
        }
        
        return startResult;
        
    } catch (error) {
        console.error("❌ Failed to start auto recording from iframe:", error);
        currentRecordingTab = null;
        isAutoRecording = false;
        return { success: false, error: error.message };
    }
}

async function startRecordingWithRetry(recorderTabId, targetTabId, service, isAuto, maxRetries = 8) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`🔄 Attempting to start recording (attempt ${attempt + 1}/${maxRetries})...`);
        
        try {
            const delay = 1000 * Math.pow(1.5, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const response = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(recorderTabId, { 
                    action: "startRecording", 
                    tabId: targetTabId,
                    autoRecord: isAuto,
                    service: service,
                    isIframe: !isAuto ? false : true
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
            
            if (response && response.success) {
                console.log("✅ Recording started successfully");
                return { success: true };
            } else {
                console.log(`❌ Attempt ${attempt + 1} returned failure:`, response);
            }
            
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
                    
                    setTimeout(() => {
                        chrome.tabs.remove(tab.id).catch(() => {});
                    }, 2000);
                    
                } catch (err) {
                    console.log("⚠️ Could not send stop message to recorder tab:", err.message);
                    await chrome.tabs.remove(tab.id);
                }
            }
        }
        
        await chrome.storage.local.remove(['isRecording', 'recordingTime']);
        currentRecordingTab = null;
        isAutoRecording = false;
        
    } catch (error) {
        console.error("❌ Error during stop recording cleanup:", error);
    }
}

// Updated service detection to include Google Chat huddle popups
function detectServiceFromUrl(url) {
    if (!url) return null;
    
    // Google Meet
    if (url.includes('meet.google.com')) return 'gmeet';
    
    // Google Chat Huddle - detect popup windows and iframes
    if (url.includes('chat.google.com') || url.includes('mail.google.com')) {
        // Check if it's a huddle call (popup window or iframe)
        if (url.includes('huddle') || url.includes('call') || url.includes('video') ||
            url.includes('meet') || url.includes('conference') || url.includes('frame')) {
            console.log("🎯 Detected Google Chat Huddle:", url);
            return 'gchat';
        }
        // Regular chat page (not a huddle)
        return 'gchat';
    }
    
    // Microsoft Teams
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    
    // Zoom
    if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
    
    return null;
}

// Listen for new tabs (to detect huddle popups)
chrome.tabs.onCreated.addListener(async (tab) => {
    console.log("🆕 New tab created:", tab.id, tab.url);
    
    if (tab.url && (tab.url.includes('chat.google.com') || tab.url.includes('meet.google.com'))) {
        if (tab.url.includes('huddle') || tab.url.includes('call') || tab.url.includes('frame')) {
            console.log("🎯 New Google Chat Huddle popup detected!");
            
            // Wait a bit for the huddle to load
            setTimeout(async () => {
                const service = detectServiceFromUrl(tab.url);
                if (service === 'gchat') {
                    // Check if auto-record is enabled
                    const result = await chrome.storage.local.get(['autoRecordPermissions']);
                    const autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
                    
                    if (autoRecordEnabled) {
                        console.log("🎬 Auto-record enabled for huddle - starting recording in 3 seconds");
                        setTimeout(async () => {
                            await startManualRecording(tab.id, 'gchat');
                        }, 3000);
                    }
                }
            }, 2000);
        }
    }
});

// Listen for tab updates (when a page changes to a huddle)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url && (changeInfo.url.includes('chat.google.com') || changeInfo.url.includes('meet.google.com'))) {
        if (changeInfo.url.includes('huddle') || changeInfo.url.includes('call') || changeInfo.url.includes('frame')) {
            console.log("🎯 Tab updated to Google Chat Huddle:", tabId);
            
            const service = detectServiceFromUrl(changeInfo.url);
            if (service === 'gchat') {
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
                
                if (autoRecordEnabled) {
                    console.log("🎬 Auto-record enabled for huddle - starting recording");
                    setTimeout(async () => {
                        await startManualRecording(tabId, 'gchat');
                    }, 3000);
                }
            }
        }
    }
});

// Listen for tab closure to clean up recording
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    console.log("Tab closed:", tabId);
    
    if (currentRecordingTab === tabId) {
        console.log("🎬 Recording tab was closed - cleaning up");
        await stopRecordingAndCleanup();
    }
    
    const result = await chrome.storage.local.get(['currentMeetingTab']);
    if (result.currentMeetingTab === tabId) {
        console.log("📞 Meeting/Huddle tab closed - stopping any active recording");
        await stopRecordingAndCleanup();
        await chrome.storage.local.remove(['currentMeetingTab', 'currentService']);
    }
});

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("Extension installed/updated:", details.reason);
    
    const result = await chrome.storage.local.get(['autoRecordPermissions']);
    if (!result.autoRecordPermissions) {
        await chrome.storage.local.set({ autoRecordPermissions: {} });
    }
});

// Periodic cleanup of stale recorder tabs
setInterval(async () => {
    try {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        const result = await chrome.storage.local.get(['isRecording']);
        
        if (tabs.length > 0 && !result.isRecording) {
            console.log("🧹 Cleaning up stale recorder tabs");
            for (const tab of tabs) {
                await chrome.tabs.remove(tab.id);
            }
        }
    } catch (error) {
        console.error("Error during cleanup:", error);
    }
}, 60000);

// Helper function to get current active tab
async function getCurrentTab() {
    const queryOptions = { active: true, currentWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

// Export for debugging (optional)
console.log("✅ Background service worker loaded successfully");
console.log("📱 Meeting Recorder extension ready - Supports: Google Meet, Teams, Zoom, Google Chat Huddle");