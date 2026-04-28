// UNIFIED POPUP.JS - Google Meet, Microsoft Teams, Zoom & Google Chat

let activeTabId;
let isRecording = false;
let autoRecordEnabled = false;
let currentService = null;
let hasMicrophonePermission = false;

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
    gchat: {
        name: 'Google Chat',
        icon: '💬',
        domains: ['chat.google.com', 'mail.google.com'],
        contentScript: 'content.js',
        noteElement: 'gchatNote',
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

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🔍 Universal Recorder popup opened");
    
    try {
        await initializePopup();
        startUISyncChecker();
        startRecordingStatusChecker();
        await checkMicrophonePermission();
    } catch (error) {
        console.error("❌ Error initializing popup:", error);
        updateStatus("❌ Error initializing extension", "error");
    }
});

// Check and request microphone permission
async function checkMicrophonePermission() {
    try {
        // Check if we already have permission
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
        console.log("🎤 Microphone permission state:", permissionStatus.state);
        
        if (permissionStatus.state === 'granted') {
            hasMicrophonePermission = true;
            updateStatus("✅ Microphone access granted", "success");
            return true;
        } else if (permissionStatus.state === 'prompt') {
            // Request permission
            updateStatus("🎤 Requesting microphone access...", "info");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            hasMicrophonePermission = true;
            updateStatus("✅ Microphone access granted", "success");
            return true;
        } else {
            updateStatus("⚠️ Microphone access denied. Enable in Chrome settings.", "warning");
            hasMicrophonePermission = false;
            return false;
        }
    } catch (err) {
        console.warn("⚠️ Microphone permission error:", err);
        updateStatus("⚠️ Please allow microphone access for recording", "warning");
        hasMicrophonePermission = false;
        return false;
    }
}

function startRecordingStatusChecker() {
    setInterval(async () => {
        const result = await chrome.storage.local.get(['isRecording', 'recordingTime']);
        if (result.isRecording !== isRecording) {
            isRecording = result.isRecording || false;
            if (isRecording) {
                updateUIForRecording(result.recordingTime || "00:00");
            } else {
                updateUIForReady();
            }
        } else if (isRecording && result.recordingTime) {
            const timerElement = document.getElementById("timer");
            if (timerElement) timerElement.textContent = result.recordingTime;
        }
    }, 1000);
}

function highlightAutoDetectedService(service) {
    const gmeetOption = document.getElementById('gmeetOption');
    const gchatOption = document.getElementById('gchatOption');
    const teamsOption = document.getElementById('teamsOption');
    const zoomOption = document.getElementById('zoomOption');
    const serviceSelector = document.querySelector('.service-selector');
    
    gmeetOption.classList.remove('active', 'auto-detected', 'locked');
    gchatOption.classList.remove('active', 'auto-detected', 'locked');
    teamsOption.classList.remove('active', 'auto-detected', 'locked');
    zoomOption.classList.remove('active', 'auto-detected', 'locked');
    
    gmeetOption.style.pointerEvents = 'none';
    gchatOption.style.pointerEvents = 'none';
    teamsOption.style.pointerEvents = 'none';
    zoomOption.style.pointerEvents = 'none';
    
    if (service === 'gmeet') {
        gmeetOption.classList.add('auto-detected', 'locked');
        gmeetOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Google Meet - Service locked to current page`;
    } else if (service === 'gchat') {
        gchatOption.classList.add('auto-detected', 'locked');
        gchatOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Google Chat - Service locked to current page`;
    } else if (service === 'teams') {
        teamsOption.classList.add('auto-detected', 'locked');
        teamsOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Microsoft Teams - Service locked to current page`;
    } else if (service === 'zoom') {
        zoomOption.classList.add('auto-detected', 'locked');
        zoomOption.querySelector('input').checked = true;
        serviceSelector.title = `🔒 Auto-detected: Zoom - Service locked to current page`;
    }
    
    serviceSelector.classList.add('auto-detected-mode');
}

function enableServiceSelection() {
    const gmeetOption = document.getElementById('gmeetOption');
    const gchatOption = document.getElementById('gchatOption');
    const teamsOption = document.getElementById('teamsOption');
    const zoomOption = document.getElementById('zoomOption');
    const serviceSelector = document.querySelector('.service-selector');
    
    gmeetOption.style.pointerEvents = 'auto';
    gchatOption.style.pointerEvents = 'auto';
    teamsOption.style.pointerEvents = 'auto';
    zoomOption.style.pointerEvents = 'auto';
    
    gmeetOption.classList.remove('auto-detected', 'locked');
    gchatOption.classList.remove('auto-detected', 'locked');
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
        
        const service = detectServiceFromUrl(tab.url);
        if (service) {
            currentService = service;
            showRecordingUI();
            highlightAutoDetectedService(service);
            updateServiceUI(service);
        } else {
            showFeaturesUI();
            enableServiceSelection();
        }
    } else {
        showFeaturesUI();
        enableServiceSelection();
    }
    
    await checkRecordingStatus();
    await checkAutoRecordPermission();
}

function setupEventListeners() {
    const autoRecordToggle = document.getElementById('autoRecordToggle');
    if (autoRecordToggle) {
        autoRecordToggle.addEventListener('change', handleAutoRecordToggle);
    }
    
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    
    if (startBtn) startBtn.addEventListener("click", handleStartRecording);
    if (stopBtn) stopBtn.addEventListener("click", handleStopRecording);
    
    document.addEventListener('focus', handlePopupFocus);
    setupTooltips();
}

function setupServiceSelection() {
    const gmeetOption = document.getElementById('gmeetOption');
    const gchatOption = document.getElementById('gchatOption');
    const teamsOption = document.getElementById('teamsOption');
    const zoomOption = document.getElementById('zoomOption');
    
    if (!gmeetOption || !gchatOption || !teamsOption || !zoomOption) return;
    
    const gmeetRadio = gmeetOption.querySelector('input');
    const gchatRadio = gchatOption.querySelector('input');
    const teamsRadio = teamsOption.querySelector('input');
    const zoomRadio = zoomOption.querySelector('input');
    
    gmeetOption.addEventListener('click', () => {
        if (gmeetOption.style.pointerEvents === 'none') return;
        gmeetRadio.checked = true;
        selectService('gmeet');
    });
    
    gchatOption.addEventListener('click', () => {
        if (gchatOption.style.pointerEvents === 'none') return;
        gchatRadio.checked = true;
        selectService('gchat');
    });
    
    teamsOption.addEventListener('click', () => {
        if (teamsOption.style.pointerEvents === 'none') return;
        teamsRadio.checked = true;
        selectService('teams');
    });

    zoomOption.addEventListener('click', () => {
        if (zoomOption.style.pointerEvents === 'none') return;
        zoomRadio.checked = true;
        selectService('zoom');
    });
    
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        const detectedService = detectServiceFromUrl(tab?.url);
    
        if (!detectedService) {
            chrome.storage.local.get(['selectedService'], (result) => {
                if (result.selectedService === 'gchat') {
                    gchatRadio.checked = true;
                    selectService('gchat');
                } else if (result.selectedService === 'teams') {
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
    });
}

async function selectService(service) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const detectedService = detectServiceFromUrl(tab?.url);
    
    if (detectedService) {
        console.log(`❌ Cannot switch services while on ${SERVICE_CONFIG[detectedService].name} page`);
        
        const targetOption = document.getElementById(
            service === 'gmeet' ? 'gmeetOption' : 
            service === 'gchat' ? 'gchatOption' :
            service === 'teams' ? 'teamsOption' : 'zoomOption'
        );
        if (targetOption) {
            targetOption.style.transform = 'scale(0.95)';
            setTimeout(() => {
                targetOption.style.transform = '';
            }, 300);
        }
        
        showPopupMessage(`❌ Service locked to ${SERVICE_CONFIG[detectedService].name}, since in ${SERVICE_CONFIG[detectedService].name} page.`, 'warning');
        return;
    }
    
    currentService = service;
    chrome.storage.local.set({ selectedService: service });
    
    updateServiceUI(service);
    await checkAutoRecordPermission();
    
    console.log(`✅ Service selected: ${service}`);
}

function detectServiceFromUrl(url) {
    if (!url) return null;
    if (url.includes('meet.google.com')) return 'gmeet';
    if (url.includes('chat.google.com') || (url.includes('mail.google.com') && url.includes('chat'))) return 'gchat';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
    return null;
}

function updateServiceUI(service) {
    updateTheme(service);
    
    const gmeetNote = document.getElementById('gmeetNote');
    const gchatNote = document.getElementById('gchatNote');
    const teamsNote = document.getElementById('teamsNote');
    const zoomNote = document.getElementById('zoomNote');
    
    if (gmeetNote) gmeetNote.style.display = service === 'gmeet' ? 'block' : 'none';
    if (gchatNote) gchatNote.style.display = service === 'gchat' ? 'block' : 'none';
    if (teamsNote) teamsNote.style.display = service === 'teams' ? 'block' : 'none';
    if (zoomNote) zoomNote.style.display = service === 'zoom' ? 'block' : 'none';
    
    updateStatus(`✅ ${SERVICE_CONFIG[service].name} selected`);
    updateButtonStates();
    
    const gmeetOption = document.getElementById('gmeetOption');
    const gchatOption = document.getElementById('gchatOption');
    const teamsOption = document.getElementById('teamsOption');
    const zoomOption = document.getElementById('zoomOption');
    
    if (gmeetOption) gmeetOption.classList.toggle('active', service === 'gmeet');
    if (gchatOption) gchatOption.classList.toggle('active', service === 'gchat');
    if (teamsOption) teamsOption.classList.toggle('active', service === 'teams');
    if (zoomOption) zoomOption.classList.toggle('active', service === 'zoom');
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

function showRecordingUI() {
    const featuresSection = document.getElementById('featuresSection');
    const recordingControls = document.getElementById('recordingControls');
    
    if (featuresSection) featuresSection.style.display = 'none';
    if (recordingControls) recordingControls.style.display = 'block';
    
    console.log("✅ Showing recording UI for:", currentService);
}

function showFeaturesUI() {
    const featuresSection = document.getElementById('featuresSection');
    const recordingControls = document.getElementById('recordingControls');
    
    if (recordingControls) recordingControls.style.display = 'none';
    if (featuresSection) featuresSection.style.display = 'block';
    
    updateTheme('default');
    updateStatus("Open Google Meet, Teams, Zoom, or Google Chat to start recording", "info");
    
    console.log("📋 Showing features UI");
}

function updateStatus(message, type = "info") {
    const statusElement = document.getElementById("status");
    if (!statusElement) return;
    
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
    
    if (!startBtn || !stopBtn) return;
    
    if (autoRecordEnabled) {
        startBtn.disabled = true;
        stopBtn.disabled = true;
        startBtn.style.backgroundColor = "#666";
        stopBtn.style.backgroundColor = "#666";
        startBtn.title = "Manual recording disabled (Auto mode ON)";
        stopBtn.title = "Manual stop disabled (Auto mode ON)";
    } else {
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
    const timerElement = document.getElementById("timer");
    const startBtn = document.getElementById("startBtn");
    const statusElement = document.getElementById("status");
    const warningElement = document.getElementById("warning");
    
    if (timerElement) timerElement.textContent = recordingTime;
    if (statusElement) statusElement.textContent = "🟢 Recording in background...";
    if (startBtn) startBtn.textContent = "Recording...";
    
    if (warningElement) {
        warningElement.style.display = "none";
    }

    updateButtonStates();
}

function updateUIForReady() {
    const timerElement = document.getElementById("timer");
    const startBtn = document.getElementById("startBtn");
    const statusElement = document.getElementById("status");
    const warningElement = document.getElementById("warning");
    
    if (timerElement) timerElement.textContent = "00:00";
    
    if (activeTabId && currentService) {
        if (statusElement) statusElement.textContent = "✅ Extension is ready";
    } else {
        if (statusElement) statusElement.textContent = "✅ Extension is ready";
    }
    
    if (startBtn) startBtn.textContent = "Start Recording";
    
    if (warningElement) {
        warningElement.style.display = "none";
    }
    
    updateButtonStates();
}

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
        label.style.color = '#edf0edff';
        label.style.fontWeight = 'bold';
    }
    if (permissionText) {
        permissionText.textContent = autoRecordEnabled 
            ? 'Auto recording enabled ✅' 
            : 'Automatically record when joining meetings';
        permissionText.style.color = '#edf0edff';
    }
}

async function handleAutoRecordToggle(e) {
    const enabled = e.target.checked;
    
    if (enabled) {
        const serviceName = SERVICE_CONFIG[currentService]?.name || 'meeting';
        const confirmed = confirm(`Enable Auto Recording for ${serviceName}?\n\nThis will automatically start recording when you join ${serviceName} and stop when you leave.\n\nManual recording buttons will be disabled.\n\nYou can disable this anytime in the extension.`);
        
        if (confirmed) {
            try {
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const permissions = result.autoRecordPermissions || {};
                permissions[currentService] = true;
                
                await chrome.storage.local.set({ autoRecordPermissions: permissions });
                autoRecordEnabled = true;
                updateToggleUI();
                updateButtonStates();
                
                await chrome.runtime.sendMessage({ 
                    action: "grantAutoRecordPermission", 
                    service: currentService
                });
                
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
            const result = await chrome.storage.local.get(['autoRecordPermissions']);
            const permissions = result.autoRecordPermissions || {};
            permissions[currentService] = false;
            
            await chrome.storage.local.set({ autoRecordPermissions: permissions });
            autoRecordEnabled = false;
            updateToggleUI();
            updateButtonStates();
            
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
    console.log("🎬 Manual start recording button clicked");
    
    if (!activeTabId || !currentService) {
        updateStatus("❌ Please refresh the meeting page", "error");
        showPopupMessage("Please refresh the meeting page and try again", "error");
        return;
    }

    if (autoRecordEnabled) {
        alert("❌ Manual recording disabled while Auto Mode is ON\nPlease turn off Auto Mode to use manual recording");
        return;
    }

    if (isRecording) {
        showPopupMessage("Recording is already in progress!", "warning");
        return;
    }

    // Check microphone permission before starting
    if (!hasMicrophonePermission) {
        const micGranted = await checkMicrophonePermission();
        if (!micGranted) {
            const confirmStart = confirm("Microphone access is not granted. Continue recording without microphone audio?");
            if (!confirmStart) {
                return;
            }
        }
    }

    try {
        const startBtn = document.getElementById("startBtn");
        const statusElement = document.getElementById("status");
        
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = "Starting...";
        }
        if (statusElement) statusElement.textContent = "🟡 Starting recording...";

        await chrome.tabs.update(activeTabId, { active: true });
        await new Promise(resolve => setTimeout(resolve, 500));

        if (currentService && SERVICE_CONFIG[currentService].manualStartAction) {
            try {
                await chrome.tabs.sendMessage(activeTabId, { 
                    action: SERVICE_CONFIG[currentService].manualStartAction 
                });
            } catch (err) {
                console.log("⚠️ Could not notify content script:", err.message);
            }
        }

        console.log("📤 Sending manualStartRecording to background with tabId:", activeTabId, "service:", currentService);
        
        const response = await chrome.runtime.sendMessage({ 
            action: "manualStartRecording", 
            tabId: activeTabId,
            service: currentService
        });
        
        console.log("📥 Background response:", response);
        
        if (response && response.success) {
            console.log("✅ Manual recording started successfully");
            isRecording = true;
            updateStatus("✅ Recording started! Check the recorder window.", "success");
            showPopupMessage("Recording started successfully! 🎬", "success");
            
            setTimeout(() => {
                updateUIForRecording("00:00");
            }, 1000);
        } else {
            throw new Error(response?.error || "Failed to start recording - no response from background");
        }

    } catch (error) {
        console.error("❌ Start recording failed:", error);
        updateStatus("❌ Failed to start: " + error.message, "error");
        showPopupMessage("Failed to start recording: " + error.message, "error");
        updateUIForReady();
        
        const startBtn = document.getElementById("startBtn");
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = "Start Recording";
        }
    }
}

async function handleStopRecording() {
    console.log("🛑 Manual stop recording button clicked");
    
    if (autoRecordEnabled) {
        alert("❌ Manual stop disabled while Auto Mode is ON\nRecording will stop automatically when you leave the meeting");
        return;
    }

    if (!isRecording) {
        showPopupMessage("No active recording to stop", "warning");
        return;
    }

    try {
        const stopBtn = document.getElementById("stopBtn");
        const statusElement = document.getElementById("status");
        
        if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.textContent = "Stopping...";
        }
        if (statusElement) statusElement.textContent = "🟡 Stopping recording...";

        if (currentService && SERVICE_CONFIG[currentService].manualStopAction) {
            try {
                await chrome.tabs.sendMessage(activeTabId, { 
                    action: SERVICE_CONFIG[currentService].manualStopAction 
                });
            } catch (err) {
                console.log("⚠️ Could not notify content script:", err.message);
            }
        }

        await stopRecordingAndDownload();
        
    } catch (error) {
        console.error("❌ Stop recording failed:", error);
        updateStatus("❌ Stop failed: " + error.message, "error");
        showPopupMessage("Failed to stop recording: " + error.message, "error");
        updateUIForReady();
    }
}

async function stopRecordingAndDownload() {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
    if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "stopRecording" }, (response) => {
            if (chrome.runtime.lastError) {
                console.log("⚠️ Recorder tab not responding:", chrome.runtime.lastError.message);
            } else {
                console.log("✅ Stop recording message sent");
            }
        });
        
        isRecording = false;
        updateUIForReady();
        showPopupMessage("Recording stopped! File will be downloaded shortly.", "success");
    } else {
        await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStoppedByTabClose']);
        isRecording = false;
        updateUIForReady();
        showPopupMessage("No active recorder found", "warning");
    }
}

async function checkMeetingStatus() {
    if (!activeTabId || !currentService) return;
    
    try {
        const response = await chrome.tabs.sendMessage(activeTabId, { 
            action: SERVICE_CONFIG[currentService].checkMeetingAction 
        });
        if (response) {
            updateMeetingStatusUI(response.isInMeeting, response.recording);
        }
    } catch (error) {
        console.log("⚠️ Could not check meeting status:", error.message);
    }
}

function updateMeetingStatusUI(isInMeeting, isRecordingFlag) {
    const statusElement = document.getElementById("status");
    if (!statusElement) return;
    
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

function handlePopupFocus() {
    if (activeTabId && currentService) {
        checkMeetingStatus();
        checkRecordingStatus();
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
        max-width: 90%;
        text-align: center;
    `;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) messageDiv.parentNode.removeChild(messageDiv);
    }, 3000);
}

function setupTooltips() {
    const toggleContainer = document.querySelector('.permission-toggle');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    if (toggleContainer) toggleContainer.title = "Automatically start/stop recording when join/leave meetings";
    if (startBtn) startBtn.title = "Manually start recording current meeting";
    if (stopBtn) stopBtn.title = "Stop recording and download the video";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        console.log("📨 Popup received message:", message.action);
        
        switch (message.action) {
            case "timerUpdate":
                const timerElement = document.getElementById("timer");
                if (timerElement) timerElement.textContent = message.time;
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
                
            case "recorderFailed":
                console.error("❌ Recorder reported failure:", message.error);
                isRecording = false;
                updateStatus("❌ Recording Failed: " + message.error, "error");
                updateUIForReady();
                showPopupMessage("Recording failed: " + message.error, "error");
                break;

            case "tabUpdated":
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.status === 'complete') {
        chrome.runtime.sendMessage({ action: "tabUpdated" });
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    activeTabId = activeInfo.tabId;
    chrome.runtime.sendMessage({ action: "tabUpdated" });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.autoRecordPermissions) {
        if (currentService && changes.autoRecordPermissions.newValue) {
            autoRecordEnabled = changes.autoRecordPermissions.newValue[currentService] || false;
            updateToggleUI();
            updateButtonStates();
        }
    }
});