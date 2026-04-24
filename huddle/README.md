# Meeting Recorder - Chrome Extension

A Chrome extension that records meetings on Google Meet, Microsoft Teams, and Zoom with both automatic and manual recording modes.

## Features

- Multi-Platform Support: Google Meet, Microsoft Teams, and Zoom
- Dual Recording Modes: Automatic and Manual
- Audio Mixing: Captures both meeting audio and microphone
- Background Recording: Works even when popup is closed
- Auto Download: Recordings save automatically when meeting ends
- Real-time Timer: Live recording duration display

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked" and select the extension folder
5. Grant required permissions when prompted

## Initial Audio Permission Setup

**Important**: You must grant microphone access initially:

1. After installation, click the extension icon in Chrome toolbar
2. When prompted, allow microphone permissions
3. This one-time setup enables audio mixing in recordings

## How to Use

### Automatic Recording Mode

1. **Enable Auto-Record**:
   - Click the extension icon
   - Toggle "Auto Recording" to ON
   - Confirm permission dialog

2. **Join Meeting**:
   - Enter your Google Meet, Teams, or Zoom meeting
   - The extension automatically detects when you join

3. **Recording Starts**:
   - After 3 seconds, recording begins automatically
   - Status indicator shows recording in progress

4. **Recording Stops**:
   - When you leave the meeting, recording stops automatically
   - File downloads to your Downloads folder

### Manual Recording Mode

1. **Open Meeting**:
   - Go to your meeting page (Meet, Teams, or Zoom)

2. **Start Recording**:
   - Click the extension icon
   - Select your meeting service
   - Click "Start Recording"
   - Recording begins immediately

3. **Stop Recording**:
   - Click the extension icon again
   - Click "Stop & Download"
   - Recording stops and file downloads immediately

## File Structure & Description

**meeting-recorder/** file contains:
- **manifest.json** - Extension configuration and permissions
- **background.js** - Main service worker and central controller  
- **content.js** - Meeting detection scripts for all platforms
- **popup.html** - Popup user interface
- **popup.js** - Popup functionality and controls
- **recorder.html** - Recorder interface
- **recorder.js** - Recording engine and media processing
- **README.md** - This documentation file


## Technical Details

- Built with JavaScript, HTML5, and CSS3
- Uses Chrome Extensions API (Manifest V3)
- Implements WebRTC MediaRecorder for recording
- Uses Web Audio API for audio mixing
- Chrome Storage API (local storage) for data persistence

## Troubleshooting

### Microphone Not Working
- Click extension icon once to grant initial permissions
- Check Chrome settings: Settings > Privacy and Security > Site Settings > Microphone
- Ensure the extension has microphone access

### Auto-Record Not Starting
- Refresh the meeting page after enabling auto-record
- Ensure you're on a supported platform (Meet, Teams, or Zoom)
- Check if the correct service is selected in popup

### Recording Fails to Start
- Ensure you have sufficient storage space
- Close and reopen the extension popup
- Restart Chrome if issues persist

### Download Not Working
- Check Chrome download settings
- Ensure no popup blockers are interfering
- Verify download folder permissions

## Supported Platforms

- Google Meet: Full support (auto and manual)
- Microsoft Teams: Full support (auto and manual)  
- Zoom: Full support (auto and manual)

## Development

### Key Components:
- Background Script: Central controller and state management
- Content Scripts: Platform-specific meeting detection
- Popup Interface: User controls and settings
- Recorder Engine: Media capture and processing

### Building from Source:
1. Clone the repository
2. Load as unpacked extension in Chrome
3. Make code changes
4. Reload the extension to test changes

