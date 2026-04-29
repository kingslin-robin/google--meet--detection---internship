// background.js - Handles auto-download to Downloads folder

let currentRecordingTab = null;
let isAutoRecording = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📨 Background received:", message.action);
    
    if (message.action === "downloadRecording") {
        // Handle download from content script - auto-save to Downloads
        // Note: In MV3 service workers, we can't use URL.createObjectURL
        // The content script should provide the blob directly
        handleDirectDownload(message.data, message.filename);
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === "recordingStarted") {
        chrome.storage.local.set({ isRecording: true });
        currentRecordingTab = sender.tab?.id;
        isAutoRecording = message.isAuto || false;
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === "recordingStopped" || message.action === "recordingCompleted") {
        chrome.storage.local.remove(['isRecording', 'recordingTime']);
        currentRecordingTab = null;
        isAutoRecording = false;
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === "manualStartRecording") {
        // Forward to content script in the tab
        chrome.tabs.sendMessage(message.tabId, { 
            action: "manualRecordingStarted" 
        }, (response) => {
            sendResponse(response || { success: false });
        });
        return true;
    }
    
    if (message.action === "manualStopRecording") {
        // Forward to content script
        if (currentRecordingTab) {
            chrome.tabs.sendMessage(currentRecordingTab, { 
                action: "manualRecordingStopped" 
            }, (response) => {
                sendResponse(response || { success: true });
            });
        } else {
            sendResponse({ success: false, error: "No active recording" });
        }
        return true;
    }
    
    if (message.action === "getRecordingStatus") {
        chrome.storage.local.get(['isRecording', 'recordingTime'], (result) => {
            sendResponse({ 
                isRecording: result.isRecording || false, 
                recordingTime: result.recordingTime || "00:00" 
            });
        });
        return true;
    }
    
    if (message.action === "grantAutoRecordPermission") {
        chrome.storage.local.get(['autoRecordPermissions'], (result) => {
            const permissions = result.autoRecordPermissions || {};
            permissions[message.service] = true;
            chrome.storage.local.set({ autoRecordPermissions: permissions });
            sendResponse({ success: true });
        });
        return true;
    }
    
    if (message.action === "revokeAutoRecordPermission") {
        chrome.storage.local.get(['autoRecordPermissions'], (result) => {
            const permissions = result.autoRecordPermissions || {};
            permissions[message.service] = false;
            chrome.storage.local.set({ autoRecordPermissions: permissions });
            sendResponse({ success: true });
        });
        return true;
    }
    
    return true;
});

async function handleDirectDownload(data, filename) {
    try {
        console.log("💾 Downloading to Downloads folder:", filename);
        
        // Method 1: If data is an object with blob data
        if (data && data.type === 'blob' && data.data) {
            // Convert base64 back to blob
            const binaryString = atob(data.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: data.mimeType || 'video/webm' });
            const blobUrl = URL.createObjectURL(blob);
            
            chrome.downloads.download({
                url: blobUrl,
                filename: filename,
                saveAs: false,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Download error:", chrome.runtime.lastError);
                } else {
                    console.log("✅ Download started with ID:", downloadId, "→ Saved to Downloads folder");
                }
                setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            });
        } 
        // Method 2: Legacy - if data is a URL string
        else if (typeof data === 'string') {
            chrome.downloads.download({
                url: data,
                filename: filename,
                saveAs: false,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Download error:", chrome.runtime.lastError);
                } else {
                    console.log("✅ Download started with ID:", downloadId, "→ Saved to Downloads folder");
                }
            });
        }
        else {
            console.error("No valid data provided for download");
        }
    } catch (error) {
        console.error("Failed to download:", error);
    }
}

// Alternative: Listen for downloads from content script via blob URL
// Since service workers can't use createObjectURL, we'll use a different approach
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "downloadBlob") {
        // Content script sends blob as array buffer
        const blob = new Blob([new Uint8Array(message.data)], { type: message.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        
        chrome.downloads.download({
            url: blobUrl,
            filename: message.filename,
            saveAs: false,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download error:", chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
                console.log("✅ Download started with ID:", downloadId);
                sendResponse({ success: true, downloadId: downloadId });
            }
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        });
        return true; // Keep message channel open for async response
    }
});

// Auto-detect huddle tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url && (changeInfo.url.includes('huddle') || changeInfo.url.includes('meet.google.com/_/frame'))) {
        console.log("🎯 Huddle detected:", tabId);
        
        const result = await chrome.storage.local.get(['autoRecordPermissions']);
        const autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
        
        if (autoRecordEnabled) {
            console.log("🎬 Auto-recording huddle");
            // Wait for content script to load
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: "startRecording", isAuto: true });
            }, 3000);
        }
    }
});

// Enhanced cleanup when tab closes - ensures auto-download triggers
chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (currentRecordingTab === tabId) {
        console.log("📞 Meeting tab closed - checking for active recording");
        
        // Get recording status before cleanup
        const result = await chrome.storage.local.get(['isRecording']);
        
        if (result.isRecording) {
            console.log("🔄 Recording was active - will auto-save");
            // Give content script a moment to process and save
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
        await chrome.storage.local.remove(['isRecording', 'recordingTime']);
        currentRecordingTab = null;
        isAutoRecording = false;
    }
});

console.log("✅ Background service worker loaded - Auto-save to Downloads enabled");