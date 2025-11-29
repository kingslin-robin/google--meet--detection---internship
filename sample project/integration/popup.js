// UNIFIED POPUP.JS - Google Meet, Microsoft Teams & Zoom

let activeTabId;
let isRecording = false;
let autoRecordEnabled = false;
let currentService = null; // 'gmeet', 'teams', or null

// Service configuration
const SERVICE_CONFIG = {
    gmeet: {
        name: 'Google Meet',
        icon: '📹',
        domains: ['meet.google.com'],
        contentScript: 'content.js',
        noteElement: 'gmeetNote',
        theme: 'gmeet-theme',
        checkMeetingAction: 'checkMeetingStatus',
        manualStartAction: 'manualRecordingStarted',
        manualStopAction: 'manualRecordingStopped'
    },
    teams: {
        name: 'Microsoft Teams',
        icon: '💼',
        domains: ['teams.microsoft.com', 'teams.live.com'],
        contentScript: 'content.js',
        noteElement: 'teamsNote',
        theme: 'teams-theme',
        checkMeetingAction: 'checkMeetingStatus',
        manualStartAction: 'manualRecordingStarted',
        manualStopAction: 'manualRecordingStopped'
    },
    zoom: {
        name: 'Zoom',
        icon: '🎥',
        domains: ['zoom.us', 'zoom.com'],
        contentScript: 'content.js',
        noteElement: 'zoomNote',
        theme: 'zoom-theme',
        checkMeetingAction: 'checkMeetingStatus',
        manualStartAction: 'manualRecordingStarted',
        manualStopAction: 'manualRecordingStopped'
    }
};

// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🔍 Universal Recorder popup opened");
    
    try {
        await initializePopup();
        startUISyncChecker();
    } catch (error) {
        console.error("❌ Error initializing popup:", error);
        updateStatus("❌ Error initializing extension", "error");
    }
});

function highlightAutoDetectedService(service) {
    const gmeetOption = document.getElementById('gmeetOption');
    const teamsOption = document.getElementById('teamsOption');
    const zoomOption = document.getElementById('zoomOption');
    const serviceSelector = document.querySelector('.service-selector');
    
    // Reset both options first
    gmeetOption.classList.remove('active', 'auto-detected', 'locked');
    teamsOption.classList.remove('active', 'auto-detected', 'locked');
    zoomOption.classList.remove('active', 'auto-detected', 'locked');
    
    // Disable clicking
    gmeetOption.style.pointerEvents = 'none';
    teamsOption.style.pointerEvents = 'none';
    zoomOption.style.pointerEvents = 'none';
    
    // Add special styling for auto-detected service
    if (service === 'gmeet') {
        gmeetOption.classList.add('auto-detected', 'locked');
        gmeetOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Google Meet - Service locked to current page`;
    } else if (service === 'teams') {
        teamsOption.classList.add('auto-detected', 'locked');
        teamsOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Microsoft Teams - Service locked to current page`;
    } else if (service === 'zoom') {
        zoomOption.classList.add('auto-detected', 'locked');
        zoomOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Zoom - Service locked to current page`;
    }
    
    // Visual indicator for the selector
    serviceSelector.classList.add('auto-detected-mode');
}

function enableServiceSelection() {
    const gmeetOption = document.getElementById('gmeetOption');
    const teamsOption = document.getElementById('teamsOption');
    const zoomOption = document.getElementById('zoomOption');
    const serviceSelector = document.querySelector('.service-selector');
    
    // Enable clicking
    gmeetOption.style.pointerEvents = 'auto';
    teamsOption.style.pointerEvents = 'auto';
    zoomOption.style.pointerEvents = 'auto';
    
    // Remove auto-detected styling
    gmeetOption.classList.remove('auto-detected', 'locked');
    teamsOption.classList.remove('auto-detected', 'locked');
    zoomOption.classList.remove('auto-detected', 'locked');
    serviceSelector.classList.remove('auto-detected-mode');
    serviceSelector.title = 'Select meeting service';
}

async function initializePopup() {
    setupEventListeners();
    setupServiceSelection();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab && tab.url) {
        activeTabId = tab.id;
        
        // Detect if we're on a supported service or other website
        const service = detectServiceFromUrl(tab.url);
        if (service) {
            // We're on Google Meet or Teams - show recording UI
            currentService = service;
            showRecordingUI();
            // VISUALLY HIGHLIGHT THE AUTO-DETECTED SERVICE
            highlightAutoDetectedService(service);

            updateServiceUI(service);
        } else {
            // We're on other website - show features
            showFeaturesUI();
            enableServiceSelection();
        }
    } else {
        // No active tab or URL - show features
        showFeaturesUI();
        enableServiceSelection();
    }
    
    await checkRecordingStatus();
    await checkAutoRecordPermission();
}

function setupEventListeners() {
    setupServiceSelection();

    // Auto record toggle
    document.getElementById('autoRecordToggle').addEventListener('change', handleAutoRecordToggle);
    
    // Recording buttons
    document.getElementById("startBtn").addEventListener("click", handleStartRecording);
    document.getElementById("stopBtn").addEventListener("click", handleStopRecording);
    
    // Popup focus
    document.addEventListener('focus', handlePopupFocus);
    
    setupTooltips();
}

// ==================== SERVICE SELECTION ====================
function setupServiceSelection() {
    const gmeetOption = document.getElementById('gmeetOption');
    const teamsOption = document.getElementById('teamsOption');
    const gmeetRadio = gmeetOption.querySelector('input');
    const teamsRadio = teamsOption.querySelector('input');
    const zoomRadio = zoomOption.querySelector('input');
    
    gmeetOption.addEventListener('click', () => {
        gmeetRadio.checked = true;
        selectService('gmeet');
    });
    
    teamsOption.addEventListener('click', () => {
        teamsRadio.checked = true;
        selectService('teams');
    });

    zoomOption.addEventListener('click', () => {
        zoomRadio.checked = true;
        selectService('zoom');
    });
    
    // Load last selected service
    chrome.storage.local.get(['selectedService'], (result) => {
        if (result.selectedService === 'teams') {
            teamsRadio.checked = true;
            selectService('teams');
        } else if (result.selectedService === 'zoom') {
            zoomRadio.checked = true;
            selectService('zoom');
        } else {
            gmeetRadio.checked = true;
            selectService('gmeet');
        } 
    });
}

async function selectService(service) {
    // Only allow service switching if we're NOT on an actual meeting page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const detectedService = detectServiceFromUrl(tab?.url);
    
    if (detectedService) {
        // On actual meeting page - prevent switching with visual feedback
        console.log(`❌ Cannot switch services while on ${SERVICE_CONFIG[detectedService].name} page`);
        
        // Show a quick visual feedback that switching is disabled
        const targetOption = document.getElementById(service === 'gmeet' ? 'gmeetOption' : 
                                                     service === 'teams' ? 'teamsOption' : 'zoomOption');
        targetOption.style.transform = 'scale(0.95)';
        setTimeout(() => {
            targetOption.style.transform = '';
        }, 300);
        
        showPopupMessage(`❌ Service locked to ${SERVICE_CONFIG[detectedService].name}, since in ${SERVICE_CONFIG[detectedService].name} page.`, 'warning');
        return;
    }
    
    currentService = service;
    chrome.storage.local.set({ selectedService: service });
    
    // Update UI based on selected service
    updateServiceUI(service);
    checkAutoRecordPermission();
    
    console.log(`✅ Service selected: ${service}`);
}

function updateServiceUI(service) {
    // Update theme
    updateTheme(service);
    
    // Update service-specific notes
    document.getElementById('gmeetNote').style.display = service === 'gmeet' ? 'block' : 'none';
    document.getElementById('teamsNote').style.display = service === 'teams' ? 'block' : 'none';
    document.getElementById('zoomNote').style.display = service === 'zoom' ? 'block' : 'none';
    
    // Update status
    updateStatus(`✅ ${SERVICE_CONFIG[service].name} selected`);
    
    // Update button states
    updateButtonStates();
    
    // Update service options visual state
    document.getElementById('gmeetOption').classList.toggle('active', service === 'gmeet');
    document.getElementById('teamsOption').classList.toggle('active', service === 'teams');
    document.getElementById('zoomOption').classList.toggle('active', service === 'zoom');
}

// ==================== UI MODES ====================

function showRecordingUI() {
    // Hide features section
    document.getElementById('featuresSection').style.display = 'none';
    
    // Show recording controls
    document.getElementById('recordingControls').style.display = 'block';
    
    // Update service indicator
    const serviceIndicator = document.getElementById('serviceIndicator');
    if (serviceIndicator) {
        serviceIndicator.innerHTML = `${SERVICE_CONFIG[currentService].icon} ${SERVICE_CONFIG[currentService].name}`;
    }
    
    console.log("✅ Showing recording UI for:", currentService);
}

function showFeaturesUI() {
    // Hide recording controls
    document.getElementById('recordingControls').style.display = 'none';
    
    // Show features section
    document.getElementById('featuresSection').style.display = 'block';
    
    // Reset to default theme
    updateTheme('default');
    
    // Update status to guide user
    updateStatus("Open Google Meet or Teams to start recording", "info");
    
    console.log("📋 Showing features UI");
}

// ==================== SERVICE MANAGEMENT ====================
function detectServiceFromUrl(url) {
    if (url.includes('meet.google.com')) return 'gmeet';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
    return null;
}

async function setCurrentService(service) {
    if (!service || !SERVICE_CONFIG[service]) {
        console.log("⚠️ Invalid service:", service);
        return;
    }
    
    currentService = service;
    await chrome.storage.local.set({ preferredService: service });
    
    console.log(`✅ Service set to: ${SERVICE_CONFIG[service].name}`);
}

function updateTheme(service) {
    const body = document.body;
    body.className = '';
    if (service && SERVICE_CONFIG[service]) {
        body.classList.add(SERVICE_CONFIG[service].theme);
    } else {
        body.classList.add('default-theme');
    }
}

// ==================== UI UPDATES ====================
function updateStatus(message, type = "info") {
    const statusElement = document.getElementById("status");
    statusElement.textContent = message;
    
    switch (type) {
        case "error":
            statusElement.style.color = "#f44336";
            break;
        case "warning":
            statusElement.style.color = "#FF9800";
            break;
        case "success":
            statusElement.style.color = "#4CAF50";
            break;
        default:
            statusElement.style.color = "#ffffff";
    }
}

function updateButtonStates() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    
    if (autoRecordEnabled) {
        // Auto mode ON - disable manual buttons
        startBtn.disabled = true;
        stopBtn.disabled = true;
        startBtn.style.backgroundColor = "#666";
        stopBtn.style.backgroundColor = "#666";
        startBtn.title = "Manual recording disabled (Auto mode ON)";
        stopBtn.title = "Manual stop disabled (Auto mode ON)";
    } else {
        // Auto mode OFF - enable manual buttons based on recording status
        if (isRecording) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            startBtn.style.backgroundColor = "#666";
            stopBtn.style.backgroundColor = "#f44336";
        } else {
            startBtn.disabled = !activeTabId || !currentService;
            stopBtn.disabled = true;
            startBtn.style.backgroundColor = (activeTabId && currentService) ? "#4CAF50" : "#666";
            stopBtn.style.backgroundColor = "#666";
        }
        startBtn.title = "Manually start recording";
        stopBtn.title = "Stop recording and download";
    }
}

function updateUIForRecording(recordingTime) {
    document.getElementById("timer").textContent = recordingTime;
    document.getElementById("status").textContent = "🟢 Recording in background...";
    document.getElementById("startBtn").textContent = "Recording...";
    
    // Add null check for warning element
    const warningElement = document.getElementById("warning");
    if (warningElement) {
        // Hide warning for all services
        warningElement.style.display = "none";
    }

    updateButtonStates();
}

function updateUIForReady() {
    document.getElementById("timer").textContent = "00:00";
    
    if (activeTabId && currentService) {
        document.getElementById("status").textContent = "✅ Extension is ready";
    } else {
        document.getElementById("status").textContent = "✅ Extension is ready";
    }
    
    document.getElementById("startBtn").textContent = "Start Recording";
    
    // Add null check for warning element
    const warningElement = document.getElementById("warning");
    if (warningElement) {
        // Hide warning for all services
        warningElement.style.display = "none";
    }
    
    updateButtonStates();
}

// ==================== AUTO RECORD MANAGEMENT ====================
async function checkAutoRecordPermission() {
    const result = await chrome.storage.local.get(['autoRecordPermissions']);
    autoRecordEnabled = result.autoRecordPermissions?.[currentService] || false;
    updateToggleUI();
    return autoRecordEnabled;
}

function updateToggleUI() {
    const toggle = document.getElementById('autoRecordToggle');
    const label = document.getElementById('toggleLabel');
    const permissionText = document.getElementById('permissionText');
    
    if (toggle) toggle.checked = autoRecordEnabled;
    if (label) {
        label.textContent = autoRecordEnabled ? 'ON' : 'OFF';
        label.style.color = autoRecordEnabled ? '#edf0edff' : '#edf0edff';
        label.style.fontWeight = 'bold';
    }
    if (permissionText) {
        permissionText.textContent = autoRecordEnabled 
            ? 'Auto recording enabled ✅' 
            : 'Automatically record when joining meetings';
        permissionText.style.color = autoRecordEnabled ? '#edf0edff' : '#edf0edff';
    }
}

async function checkCurrentMeetingAndStartRecording() {
    if (!activeTabId || !currentService) return;
    
    try {
        const response = await new Promise((resolve) => {
            chrome.tabs.sendMessage(activeTabId, { 
                action: SERVICE_CONFIG[currentService].checkMeetingAction 
            }, resolve);
        });
        
        if (response && response.isInMeeting) {
            console.log("🎬 Currently in meeting - starting auto recording immediately");
            
            // Notify content script to start recording immediately
            await chrome.runtime.sendMessage({ 
                action: "autoRecordToggledOn",
                service: currentService,
                enabled: true
            });
            
            showPopupMessage("Auto recording started for current meeting! 🎬", "success");
        }
    } catch (error) {
        console.log("⚠️ Could not check meeting status:", error);
    }
}

async function handleAutoRecordToggle(e) {
    const enabled = e.target.checked;
    
    if (enabled) {
        const serviceName = SERVICE_CONFIG[currentService]?.name || 'meeting';
        const confirmed = confirm(`Enable Auto Recording for ${serviceName}?\n\nThis will automatically start recording when you join ${serviceName} and stop when you leave.\n\nManual recording buttons will be disabled.\n\nYou can disable this anytime in the extension.`);
        
        if (confirmed) {
            try {
                // Store service-specific permission
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const permissions = result.autoRecordPermissions || {};
                permissions[currentService] = true; // Works for both 'gmeet' and 'teams'
                
                await chrome.storage.local.set({ autoRecordPermissions: permissions });
                autoRecordEnabled = true; 
                updateToggleUI();
                updateButtonStates();
                
                // Grant permission in background for the current service only
                await chrome.runtime.sendMessage({ 
                    action: "grantAutoRecordPermission", 
                    service: currentService // Works for both 'gmeet' and 'teams'
                });

                await checkCurrentMeetingAndStartRecording();
                
                showPopupMessage(`Auto recording enabled for ${serviceName}! 🎬\nManual buttons disabled`, "success");
            } catch (error) {
                console.error("❌ Failed to enable auto recording:", error);
                e.target.checked = false;
                showPopupMessage("Failed to enable auto recording", "error");
            }
        } else {
            e.target.checked = false;
        }
    } else {
        try {
            // Remove service-specific permission
            const result = await chrome.storage.local.get(['autoRecordPermissions']);
            const permissions = result.autoRecordPermissions || {};
            permissions[currentService] = false;
            
            await chrome.storage.local.set({ autoRecordPermissions: permissions });
            autoRecordEnabled = false;
            updateToggleUI();
            updateButtonStates();
            
            // Revoke permission in background for the current service only
            await chrome.runtime.sendMessage({ 
                action: "revokeAutoRecordPermission", 
                service: currentService 
            });
            
            showPopupMessage(`Auto recording disabled for ${SERVICE_CONFIG[currentService]?.name}\nManual buttons enabled`, "info");
        } catch (error) {
            console.error("❌ Failed to disable auto recording:", error);
            e.target.checked = true;
            showPopupMessage("Failed to disable auto recording", "error");
        }
    }
}

// ==================== RECORDING MANAGEMENT ====================
async function checkRecordingStatus() {
    const result = await chrome.storage.local.get(['isRecording', 'recordingTime', 'recordingStoppedByTabClose']);
    isRecording = result.isRecording || false;

    if (result.recordingStoppedByTabClose) {
        console.log("🔄 Recording was stopped by tab closure - resetting UI");
        isRecording = false;
        await chrome.storage.local.remove(['recordingStoppedByTabClose']);
    }

    if (isRecording) {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        if (tabs.length === 0) {
            console.log("🔄 No recorder tabs found but storage says recording - resetting UI");
            isRecording = false;
            await chrome.storage.local.set({ isRecording: false });
            updateUIForReady();
        } else {
            updateUIForRecording(result.recordingTime || "00:00");
        }
    } else {
        updateUIForReady();
    }
}

async function handleStartRecording() {
    if (!activeTabId || !currentService) {
        updateStatus("❌ Please refresh the meeting page", "error");
        return;
    }

    if (autoRecordEnabled) {
        alert("❌ Manual recording disabled while Auto Mode is ON\nPlease turn off Auto Mode to use manual recording");
        return;
    }

    try {
        document.getElementById("startBtn").disabled = true;
        document.getElementById("startBtn").textContent = "Starting...";
        document.getElementById("status").textContent = "🟡 Starting recording...";

        // Notify content script
        if (currentService && SERVICE_CONFIG[currentService].manualStartAction) {
            chrome.tabs.sendMessage(activeTabId, { action: SERVICE_CONFIG[currentService].manualStartAction }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("⚠️ Could not notify content script:", chrome.runtime.lastError.message);
                }
            });
        }

        // Create recorder tab
        chrome.tabs.create({
            url: chrome.runtime.getURL("recorder.html"),
            active: false
        }, (tab) => {
            console.log("✅ Recorder tab opened:", tab.id);
            
            setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "startRecording", 
                    tabId: activeTabId,
                    service: currentService
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("❌ Failed to start recording:", chrome.runtime.lastError);
                        document.getElementById("status").textContent = "❌ Failed to start recording";
                        updateUIForReady();
                        showPopupMessage("Failed to start recording", "error");
                    }
                });
            }, 1000);
        });

    } catch (error) {
        console.error("❌ Start recording failed:", error);
        document.getElementById("status").textContent = "❌ Failed to start";
        alert("Failed to start recording: " + error.message);
        updateUIForReady();
        showPopupMessage("Failed to start recording", "error");
    }
}

async function handleStopRecording() {
    if (autoRecordEnabled) {
        alert("❌ Manual stop disabled while Auto Mode is ON\nRecording will stop automatically when you leave the meeting");
        return;
    }

    try {
        document.getElementById("stopBtn").disabled = true;
        document.getElementById("stopBtn").textContent = "Stopping...";
        document.getElementById("status").textContent = "🟡 Stopping recording...";

        // Notify content script
        if (currentService && SERVICE_CONFIG[currentService].manualStopAction) {
            chrome.tabs.sendMessage(activeTabId, { action: SERVICE_CONFIG[currentService].manualStopAction }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("⚠️ Could not notify content script:", chrome.runtime.lastError.message);
                }
            });
        }

        await stopRecordingAndDownload();
        
    } catch (error) {
        console.error("❌ Stop recording failed:", error);
        document.getElementById("status").textContent = "❌ Stop failed";
        alert("Failed to stop recording: " + error.message);
        updateUIForReady();
        showPopupMessage("Failed to stop recording", "error");
    }
}

async function stopRecordingAndDownload() {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
    if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "stopRecording" }, (response) => {
            if (chrome.runtime.lastError) {
                console.log("⚠️ Recorder tab not responding:", chrome.runtime.lastError.message);
            }
        });
    } else {
        await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStoppedByTabClose']);
        isRecording = false;
        updateUIForReady();
    }
}

// ==================== MEETING STATUS ====================
async function checkMeetingStatus() {
    if (!activeTabId || !currentService) return;
    
    chrome.tabs.sendMessage(activeTabId, { action: SERVICE_CONFIG[currentService].checkMeetingAction }, (response) => {
        if (chrome.runtime.lastError) {
            console.log("⚠️ Could not check meeting status:", chrome.runtime.lastError.message);
        } else if (response) {
            updateMeetingStatusUI(response.isInMeeting, response.recording);
        }
    });
}

function updateMeetingStatusUI(isInMeeting, isRecordingFlag) {
    const statusElement = document.getElementById("status");
    const serviceName = SERVICE_CONFIG[currentService]?.name || 'Meeting';

    if (isInMeeting) {
        if (isRecordingFlag) {
            statusElement.textContent = `🟢 In ${serviceName} - Recording...`;
            statusElement.style.color = "#4CAF50";
        } else {
            statusElement.textContent = `🟡 In ${serviceName} - Ready to Record`;
            statusElement.style.color = "#FF9800";
        }
    } else {
        statusElement.textContent = `⚪ Not in ${serviceName}`;
        statusElement.style.color = "#9E9E9E";
    }
}

// ==================== UTILITY FUNCTIONS ====================
function handlePopupFocus() {
    if (activeTabId && currentService) {
        checkMeetingStatus();
    }
}

function startUISyncChecker() {
    setInterval(async () => {
        if (isRecording) {
            const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
            if (tabs.length === 0) {
                console.log("🔄 UI Sync: No recorder tabs but recording flag true - resetting");
                isRecording = false;
                updateUIForReady();
                await chrome.storage.local.set({ isRecording: false });
            }
        }
    }, 3000);
}

async function closeAllRecorderTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length === 0) {
                resolve();
                return;
            }
            
            let closedCount = 0;
            tabs.forEach(tab => {
                chrome.tabs.remove(tab.id, () => {
                    closedCount++;
                    if (closedCount === tabs.length) {
                        resolve();
                    }
                });
            });
        });
    });
}

function showPopupMessage(message, type = "info") {
    const existingMessage = document.getElementById('popup-message');
    if (existingMessage) existingMessage.remove();

    const messageDiv = document.createElement('div');
    messageDiv.id = 'popup-message';
    messageDiv.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        font-weight: bold;
        z-index: 1000;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) messageDiv.parentNode.removeChild(messageDiv);
    }, 3000);
}

function setupTooltips() {
    const toggleContainer = document.querySelector('.permission-toggle');
    toggleContainer.title = "Automatically start/stop recording when join/leave meetings";
    document.getElementById('startBtn').title = "Manually start recording current meeting";
    document.getElementById('stopBtn').title = "Stop recording and download the video";
}

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        switch (message.action) {
            case "timerUpdate":
                document.getElementById("timer").textContent = message.time;
                break;
                
            case "recordingStarted":
                isRecording = true;
                updateUIForRecording("00:00");
                showPopupMessage("Recording started! 🎬", "success");
                break;
                
            case "recordingStopped":
            case "recordingCompleted":
                isRecording = false;
                updateUIForReady();
                showPopupMessage("Recording completed! ✅ Downloaded automatically", "success");
                setTimeout(closeAllRecorderTabs, 1000);
                break;
                
            case "autoStopRecording":
                stopRecordingAndDownload();
                break;
                
            case "recorderFailed":
                console.error("❌ Recorder reported failure:", message.error);
                isRecording = false;
                updateStatus("❌ Recording Failed: " + message.error, "error");
                updateUIForReady();
                break;

            case "tabUpdated":
                // Refresh UI when tab changes to detect new service
                initializePopup();
                break;
        }
        
        sendResponse({ success: true });
    } catch (error) {
        console.error("❌ Error handling message:", error);
        sendResponse({ success: false, error: error.message });
    }
    
    return true;
});

// Listen for tab updates to refresh UI
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.status === 'complete') {
        chrome.runtime.sendMessage({ action: "tabUpdated" });
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    activeTabId = activeInfo.tabId;
    chrome.runtime.sendMessage({ action: "tabUpdated" });
});

// Storage change listener for auto record permission
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.autoRecordPermissions) {
        // Only update if the current service's permission changed
        if (currentService && changes.autoRecordPermissions.newValue) {
            autoRecordEnabled = changes.autoRecordPermissions.newValue[currentService] || false;
            updateToggleUI();
            updateButtonStates();
        }
    }
});