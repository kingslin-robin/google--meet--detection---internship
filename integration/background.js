
// UNIFIED BACKGROUND.JS - Google Meet, Microsoft Teams & Zoom

(function() {
    'use strict';

    let userPermissionGranted = false;
    let currentRecordingTab = null;
    let isAutoRecording = false;
    let autoStartTimeout = null;
    let autoRecordPermissions = {};

    // Service detection
    function detectService(url) {
        if (url.includes('meet.google.com')) return 'gmeet';
        if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
        if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom'; 
        return null;
    }

    // Load saved permission state
    chrome.storage.local.get(['autoRecordPermissions'], (result) => {
        console.log("🔐 Auto record permissions:", result.autoRecordPermissions);
    });

    async function restoreAutoRecordState() {
        const result = await chrome.storage.local.get(['autoRecordPermissions']);
        autoRecordPermissions = result.autoRecordPermissions || {};
        console.log("🔧 Restored auto-record permissions:", autoRecordPermissions);
    
        // Notify all tabs about the current permissions
        notifyAllTabsOfPermissions();
    }

    function notifyAllTabsOfPermissions() {
        // Notify Google Meet tabs
        chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: "updateAutoRecordPermission",
                    enabled: autoRecordPermissions['gmeet'] || false
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        // Content script might not be ready yet, that's ok
                    }
                });
            });
        });
    
        // Notify Teams tabs
        chrome.tabs.query({ url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"] }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: "updateAutoRecordPermission",
                    enabled: autoRecordPermissions['teams'] || false            
                });
            });
        });
        
        // Notify Zoom tabs
    chrome.tabs.query({ url: ["https://*.zoom.us/*", "https://*.zoom.com/*"] }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                action: "updateAutoRecordPermission",
                enabled: autoRecordPermissions['zoom'] || false            
            });
        });
    });
    }

    chrome.runtime.onStartup.addListener(() => {
        console.log("🔄 Extension starting up - restoring auto-record state");
        restoreAutoRecordState();
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete" && tab.url) {
            const service = detectService(tab.url);
            if (service === 'gmeet') {
                handleGmeetTabUpdate(tabId, tab);
            } else if (service === 'teams') {
                handleTeamsTabUpdate(tabId, tab);
            } else if (service === 'zoom') {
                handleZoomTabUpdate(tabId, tab);
            }
        }
    });

    async function handlePermissionRecovery(tabId, service) {
        console.log("🔄 Attempting permission recovery for tab:", tabId);
    
        // Wait a bit for user to potentially interact with extension
        await new Promise(resolve => setTimeout(resolve, 3000));
    
        // Check if we can access the tab now
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab) {
                console.log("✅ Tab is accessible, retrying recording...");
            
                // Create new recorder tab
                chrome.tabs.create({
                    url: chrome.runtime.getURL("recorder.html"),
                    active: false
                }, (recorderTab) => {
                    console.log("✅ New recorder tab opened:", recorderTab.id);
                    
                    const startRecordingWithRetry = (retryCount = 0) => {
                        console.log(`🔄 Retrying recording start (attempt ${retryCount + 1})...`);
                        
                        chrome.tabs.sendMessage(recorderTab.id, { 
                            action: "startRecording", 
                            tabId: tabId,
                            autoRecord: true,
                            service: service
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.log(`❌ Recorder tab not ready (attempt ${retryCount + 1}/3), retrying...`);
                                if (retryCount < 2) {
                                    setTimeout(() => startRecordingWithRetry(retryCount + 1), 1000);
                                } else {
                                    console.error("❌ Failed to start recording after 3 attempts");
                                    chrome.tabs.remove(recorderTab.id);
                                }
                            } else {
                                console.log("✅ Recording started successfully after permission recovery");
                            }
                        });
                    };
                    
                    setTimeout(() => startRecordingWithRetry(), 1500);
                });
            }
        } catch (error) {
            console.log("❌ Tab still not accessible:", error);
        }
    }

    // ==================== GOOGLE MEET HANDLERS ====================
    async function handleGmeetTabUpdate(tabId, tab) {
        console.log("✅ Meet tab detected:", tabId, tab.url);
    
        // Check if auto-record is enabled for Google Meet
        const result = await chrome.storage.local.get(['autoRecordPermissions']);
        const gmeetAutoRecordEnabled = result.autoRecordPermissions?.['gmeet'] || false;
    
        if (gmeetAutoRecordEnabled) {
            console.log("🎬 Auto record enabled for Google Meet - monitoring meeting state");
        }
    }

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

    async function handleGmeetAutoStart(message, sender) {
        console.log("🎬 Auto-start recording requested from tab:", sender.tab?.id);

        if (autoStartTimeout) {
            clearTimeout(autoStartTimeout);
            autoStartTimeout = null;
        }

        if (!sender.tab?.id) {
            console.log("❌ No sender tab ID");
            return { success: false, reason: "no_tab_id" };
        }

        // Check service-specific permission
        const result = await chrome.storage.local.get(['autoRecordPermissions']);
        const gmeetAutoRecordEnabled = result.autoRecordPermissions?.['gmeet'] || false;
    
        if (!gmeetAutoRecordEnabled) {
            console.log("❌ Auto recording denied - no permission for Google Meet");
            return { success: false, reason: "no_permission" };
        }

        console.log("🔄 Resetting states before auto-start...");
        currentRecordingTab = null;
        isAutoRecording = false;

        await chrome.storage.local.set({ 
            isRecording: false,
            recordingStoppedByTabClose: true 
        });

        console.log("✅ Starting auto recording for tab:", sender.tab.id);
        currentRecordingTab = sender.tab.id;
        isAutoRecording = true;

        setTimeout(() => {
            startRecordingForTab(sender.tab.id, 'gmeet');
        }, 2000);

        return { success: true };
    }

    async function stopRecordingOnMeetingEnd() {
        return new Promise((resolve) => {
            chrome.tabs.query({
                url: chrome.runtime.getURL("recorder.html")
            }, (tabs) => {
                if (tabs.length > 0) {
                    let completed = 0;
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: "stopRecording",
                            forceAutoDownload: true
                        }, (_response) => {
                            if (chrome.runtime.lastError) {
                                console.log("▲ Recorder tab not responding");
                            } else {
                                console.log("■ Auto-download command sent");
                            }
                            completed++;
                            if (completed == tabs.length) {
                                currentRecordingTab = null;
                                isAutoRecording = false;
                                resolve();
                            }
                        });
                    });
                } else {
                    console.log("▲ No recorder tabs found");
                    currentRecordingTab = null;
                    isAutoRecording = false;
                    resolve();
                }
            });
        });
    }

    function notifyAllGmeetTabs(enabled) {
        chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: "updateAutoRecordPermission",
                    enabled: enabled
                });
            });
        });
    }

    // ==================== MICROSOFT TEAMS HANDLERS ====================
    function handleTeamsTabUpdate(tabId, tab) {
        console.log("✅ Teams tab detected:", tabId, tab.url);
        
        chrome.storage.local.get(['autoRecordPermissions'], (result) => {
            if (result.autoRecordPermissions) {
                console.log("🎬 Auto recording enabled - Waiting for Join button click...");
                
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { action: "checkMeetingStatus" }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log("⚠️ Content script not ready yet, will detect meeting when Join button is clicked");
                            return;
                        }
                        
                        if (response && response.isInMeeting && !response.recording) {
                            console.log("✅ Meeting already in progress - starting auto recording");
                            startRecordingForTab(tabId, 'teams');
                        }
                    });
                }, 3000);
            }
        });
    }

    function handleTeamsAutoStart(sender) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`🎬 Auto starting recording - Join button clicked (+3s delay completed) at ${timestamp}`);
        console.log("📍 Source tab:", sender.tab.id, sender.tab.url);
        startRecordingForTab(sender.tab.id, 'teams');
        return { success: true };
    }

    function notifyAllTeamsTabs(enabled) {
        chrome.tabs.query({url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"]}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: "updateAutoRecordPermission",
                    enabled: enabled
                });
            });
        });
    }

    // ==================== ZOOM HANDLERS ====================
    async function handleZoomTabUpdate(tabId, tab) {
        console.log("✅ Zoom tab detected:", tabId, tab.url);
    
        // Check if auto-record is enabled for Zoom
        const result = await chrome.storage.local.get(['autoRecordPermissions']);
        const zoomAutoRecordEnabled = result.autoRecordPermissions?.['zoom'] || false;
    
        if (zoomAutoRecordEnabled) {
            console.log("🎬 Auto record enabled for Zoom - monitoring meeting state");
        
            // Wait for content script to initialize
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: "checkMeetingStatus" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log("⚠️ Zoom content script not ready yet");
                        return;
                    }
                
                    if (response && response.isInMeeting && !response.recording) {
                        console.log("✅ Zoom meeting already in progress - starting auto recording");
                        startRecordingForTab(tabId, 'zoom');
                    }
                });
            }, 3000);
        }
    }

    function handleZoomAutoStart(sender) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`🎬 Auto starting recording for Zoom at ${timestamp}`);
        console.log("📍 Source tab:", sender.tab.id, sender.tab.url);
        startRecordingForTab(sender.tab.id, 'zoom');
        return { success: true };
    }

    function notifyAllZoomTabs(enabled) {
        chrome.tabs.query({url: ["https://*.zoom.us/*", "https://*.zoom.com/*"]}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: "updateAutoRecordPermission",
                    enabled: enabled
                });
            });
        });
    }

    // ==================== COMMON FUNCTIONS ====================
    function startRecordingForTab(tabId, service) {
        if (currentRecordingTab && !isAutoRecording) {
            console.log("⚠️ Already recording in tab:", currentRecordingTab);
            return;
        }

        console.log(`🎬 Starting recording for ${service} tab:`, tabId);
        
        chrome.tabs.create({
            url: chrome.runtime.getURL("recorder.html"),
            active: false
        }, (recorderTab) => {
            console.log("✅ Recorder tab opened:", recorderTab.id);
            
            const startRecording = (retryCount = 0) => {
                console.log(`🔄 Attempting to start recording (attempt ${retryCount + 1})...`);
                
                chrome.tabs.sendMessage(recorderTab.id, { 
                    action: "startRecording", 
                    tabId: tabId,
                    autoRecord: true,
                    service: service
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log(`❌ Recorder tab not ready (attempt ${retryCount + 1}/3), retrying...`);
                        if (retryCount < 2) {
                            setTimeout(() => startRecording(retryCount + 1), 1000);
                        } else {
                            console.error("❌ Failed to start recording after 3 attempts");
                            chrome.tabs.remove(recorderTab.id);

                            // If it's a permission issue, set up recovery
                            if (service === 'gmeet' || service === 'teams' || service === 'zoom') {
                                handlePermissionRecovery(tabId, service);
                            }
                        }
                    } else {
                        console.log("✅ Recording started successfully");
                        currentRecordingTab = tabId;
                    }
                });
            };
            
            setTimeout(() => startRecording(), 1500);
        });
    }

    function stopAllRecordings() {
        console.log("🛑 Stopping all recordings");
        
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length > 0) {
                console.log(`🛑 Stopping ${tabs.length} recorder tab(s)`);
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
                });
            } else {
                console.log("⚠️ No recorder tabs found");
            }
        });
        
        currentRecordingTab = null;
        isAutoRecording = false;
        
        chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
    }

    // ==================== MESSAGE HANDLER ====================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("📨 Background received:", message.action);
        
        const handleAsync = async () => {
            try {
                // Common permission messages
                if (message.action === "grantAutoRecordPermission") {
                    // Store service-specific permission
                    const result = await chrome.storage.local.get(['autoRecordPermissions']);
                    const permissions = result.autoRecordPermissions || {};
                    permissions[message.service] = true;
                    await chrome.storage.local.set({ autoRecordPermissions: permissions });

                    userPermissionGranted = true;
    
                    // Notify only the specific service tabs
                    if (message.service === 'gmeet') {
                        notifyAllGmeetTabs(true);
                    } else if (message.service === 'teams') {
                        notifyAllTeamsTabs(true);
                    } else if (message.service === 'zoom') {
                        notifyAllZoomTabs(true);
                    }

                    console.log(`✅ Auto record permission granted for ${message.service}`);
                    return { success: true };
                }
                if (message.action === "revokeAutoRecordPermission") {
                    // Store service-specific permission
                    const result = await chrome.storage.local.get(['autoRecordPermissions']);
                    const permissions = result.autoRecordPermissions || {};
                    permissions[message.service] = false;
                    await chrome.storage.local.set({ autoRecordPermissions: permissions });

                    userPermissionGranted = false;
    
                    // Notify only the specific service tabs
                    if (message.service === 'gmeet') {
                        notifyAllGmeetTabs(false);
                    } else if (message.service === 'teams') {
                        notifyAllTeamsTabs(false);
                    } else if (message.service === 'zoom') {
                        notifyAllZoomTabs(false);
                    }
                    console.log(`❌ Auto record permission revoked for ${message.service}`);
                    return { success: true };
                }

                if (message.action === "autoRecordToggledOn") {
                    console.log(`🔄 Auto-record toggled ON for ${message.service}, checking current meeting...`);
    
                    // Find active tabs for this service and notify them
                    let urlPatterns = [];
                    if (message.service === 'gmeet') {
                        urlPatterns = ["https://*.meet.google.com/*"];
                    } else if (message.service === 'teams') {
                        urlPatterns = ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"];
                    } else if (message.service === 'zoom') {
                        urlPatterns = ["https://*.zoom.us/*", "https://*.zoom.com/*"];
                    }
    
                    chrome.tabs.query({ url: urlPatterns }, (tabs) => {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, {
                                action: "autoRecordToggledOn",
                                enabled: true
                            }, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.log("⚠️ Could not notify tab:", tab.id, chrome.runtime.lastError.message);
                                }
                            });
                        });
                    });
    
                    return { success: true };
                }

                // Service-specific auto start
                if (message.action === "autoStartRecording") {
                    const service = detectService(sender.tab?.url);
                    if (service === 'gmeet') {
                        return await handleGmeetAutoStart(message, sender);
                    } else if (service === 'teams') {
                        return handleTeamsAutoStart(sender);
                    } else if (service === 'zoom') { 
                        return handleZoomAutoStart(sender);
                    }
                }

                // Common stop messages
                if (message.action === "autoStopRecording") {
                    console.log("🛑 Auto stop recording requested");
                    stopAllRecordings();
                    return { success: true };
                }

                if (message.action === "recordingCompleted") {
                    currentRecordingTab = null;
                    isAutoRecording = false;
                    
                    // Notify both services
                    chrome.tabs.query({ url: ["https://*.meet.google.com/*", "https://*.teams.microsoft.com/*", "https://*.teams.live.com/*", "https://*.zoom.us/*", "https://*.zoom.com/*"] }, (tabs) => {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, { action: "recordingCompleted" });
                        });
                    });

                    setTimeout(() => {
                        closeAllRecorderTabs();
                    }, 1000);

                    return { success: true };
                }
                
                if (message.action === "checkMeetingStatus") {
                    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, (response) => {
                        sendResponse(response);
                    });
                    return true;
                }

                if (message.action === "closeRecorderTab") {
                    console.log("🛑 Closing recorder tab for auto mode");
                    closeAllRecorderTabs();
                    return { success: true };
                }

                if (message.action === "stopRecordingOnMeetingEnd") {
                    console.log("🛑 Meeting ended - AUTO-DOWNLOADING recording");
                    await stopRecordingOnMeetingEnd();
                    return { success: true };
                }

                if (message.action === "showMeetStatus" || message.action === "updateMeetTimer") {
                    chrome.tabs.query({ url: "https://*.meet.google.com/*" }, (tabs) => {
                        tabs.forEach(tab => {
                            // Remove the sender check - we want to send to ALL Meet tabs
                            chrome.tabs.sendMessage(tab.id, message, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.log("⚠️ Could not send to Meet tab:", tab.id, chrome.runtime.lastError.message);
                                }
                            });
                        });
                    });
                    return { success: true };
                }

                if (message.action === "showTeamsStatus" || message.action === "updateTeamsTimer") {
                    chrome.tabs.query({ url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"] }, (tabs) => {
                        tabs.forEach(tab => {
                            // Send to ALL Teams tabs
                            chrome.tabs.sendMessage(tab.id, message, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.log("⚠️ Could not send to Teams tab:", tab.id, chrome.runtime.lastError.message);
                                }
                            });
                        });
                    });
                    return { success: true };
                }

                if (message.action === "showZoomStatus" || message.action === "updateZoomTimer") {
                    chrome.tabs.query({ url: ["https://*.zoom.us/*", "https://*.zoom.com/*"] }, (tabs) => {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, message, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.log("⚠️ Could not send to Zoom tab:", tab.id, chrome.runtime.lastError.message);
                                }
                            });
                        });
                    });
                    return { success: true };
                }

                if (message.action === "recordingStarted") {
                    const timestamp = new Date().toLocaleTimeString();
                    console.log(`✅ Recording started successfully at ${timestamp}`);
                    currentRecordingTab = sender.tab.id;
                    
                    await chrome.storage.local.set({ 
                        isRecording: true,
                        recordingStartTime: Date.now(),
                        recordingTabId: sender.tab.id
                    });
                    
                    return { success: true };
                }

                if (message.action === "recordingStopped") {
                    const timestamp = new Date().toLocaleTimeString();
                    console.log(`✅ Recording stopped successfully at ${timestamp}`);
                    currentRecordingTab = null;
                    
                    await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
                    
                    return { success: true };
                }

                if (message.action === "timerUpdate") {
                    await chrome.storage.local.set({ recordingTime: message.time });
                    return { success: true };
                }

                return { success: false, reason: "unknown_action" };
            } catch (error) {
                console.error("❌ Error handling message:", error);
                return { success: false, error: error.message };
            }
        };

        handleAsync().then(sendResponse);
        return true;
    });

    // Monitor tab closures
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === currentRecordingTab) {
            console.log("❌ Source tab closed - stopping recording");
            stopAllRecordings();
        }
        
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) return;
            
            if (tab.url && tab.url.includes("recorder.html")) {
                console.log("🛑 Recorder tab closed - cleaning up");
                chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
                currentRecordingTab = null;
                isAutoRecording = false;
            }
        });
    });

    // Handle extension installation
    chrome.runtime.onInstalled.addListener((details) => {
        console.log("🔧 Extension installed/updated:", details.reason);
        restoreAutoRecordState();
    
        if (details.reason === 'install') {
            chrome.storage.local.set({ autoRecordPermissions: {} });
            console.log("🔐 Auto recording disabled by default for all services");
        }
    });

    // Keep service worker alive
    setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {});
    }, 20000);

    console.log("🔧 Unified Background script loaded successfully");
})();
