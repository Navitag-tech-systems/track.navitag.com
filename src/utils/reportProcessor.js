/**
 * VT100 Location Processing Module for Map Rendering & Event Logging
 */
class VT100MapProcessor {
  constructor() {
    // iStartek VT100 Event codes mapping (Appendix A)
    this.EVENT_CODES = {
      0: "Interval",
      1: "SOS",
      //3: "Ignition On",
      //4: "Ignition Off",
      17: "Low Ext-Power",
      18: "Ext-Power Cut",
      19: "Ext-Power On",
      20: "Low Battery",
      22: "Speeding",
      27: "GPS Signal Loss",
      28: "GPS Signal Recovery",
      31: "Heartbeat Report",
      35: "Tow Alarm",
      38: "Idling Alarm",
      48: "Fuel Steal",
      49: "Fuel Level Low",
      50: "Enter Sleep",  
      51: "Exit Sleep"    
    };

    // Unique colors assigned for marker generation
    this.EVENT_COLORS = {
      "Start": "#fff",                  // Green (User edited to White)
      "End": "#000",                    // Red (User edited to Black)
      "Waypoint": "#808080",            // Grey (Time/Distance gap)
      "Ignition On": "#57f491",         // Light Green 
      "Ignition Off": "#ffcbd1",        // Light Pink/Red 
      "Power Cut": "#ea580c",           // Dark Orange
      "Power Restored": "#14b8a6",      // Teal
      "Low Battery": "#be123c",         // Rose
      "Battery Recovered": "#10b981",   // Emerald
      "GPS Signal Loss": "#f97316",     // Orange
      "GPS Signal Recovery": "#3b82f6", // Blue
      "GSM Signal Low": "#8b5cf6",      // Purple
      "GSM Signal Recovery": "#d946ef", // Fuchsia
      "Speeding": "#facc15",            // Yellow
      "SOS": "#dc2626",                 // Bright Red
      "Enter Sleep": "#6366f1",         // Indigo
      "Exit Sleep": "#38bdf8",          // Sky Blue
      "Default": "#eab308"              // Default Yellow
    };

    // Thresholds for telemetry-based event detection
    this.THRESHOLDS = {
      POWER_CUT_VOLTAGE: 5.0, 
      LOW_BATTERY_VOLTAGE: 3.6,
      BATTERY_RECOVERY_VOLTAGE: 3.75,
      GSM_LOW_DBM: -95,               
      MARKER_DISTANCE_METERS: 1000,   
      MARKER_TIME_MS: 60 * 60 * 1000  
    };
  }

  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  generateMapData(rawPoints) {
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
      return { line: [], markers: {}, events: [] };
    }

    const sortedPoints = [...rawPoints].sort(
      (a, b) => new Date(a.fixTime) - new Date(b.fixTime)
    );

    const line = [];
    const markers = {};
    const events = [];

    const activeStates = {
      isPowerCut: false,
      isLowBattery: false,
      isIgnitionOn: null, // Initialized to null to catch the first real state silently
      isGpsLost: false,
      isGsmLow: false
    };

    let lastMarkerData = null; 

    sortedPoints.forEach((point, index) => {
      const latlon = [point.latitude, point.longitude];
      const attrs = point.attributes || {};
      
      const eventCode = attrs.event !== undefined ? Number(attrs.event) : undefined;
      const pointTime = new Date(point.fixTime).getTime();
      
      line.push(latlon);

      const isStart = index === 0;
      const isEnd = index === sortedPoints.length - 1;
      const localEvents = [];

      const power = attrs.power;
      const battery = attrs.battery;
      const ignition = attrs.ignition;
      const validGps = point.valid;
      const gsmSignal = point.network?.cellTowers?.[0]?.signalStrength || attrs.rssi;

      // ==========================================
      // 1. STATEFUL EVENTS (Alarms + Telemetry)
      // ==========================================

      // --- Power Logic ---
      if (eventCode === 18) {
        activeStates.isPowerCut = true;
        localEvents.push({ type: "Power Cut", description: "External power cut (Alarm)." });
      } else if (eventCode === 19) {
        activeStates.isPowerCut = false;
        localEvents.push({ type: "Power Restored", description: "External power restored (Alarm)." });
      } else if (power !== undefined) {
        if (power < this.THRESHOLDS.POWER_CUT_VOLTAGE && !activeStates.isPowerCut) {
          activeStates.isPowerCut = true;
          localEvents.push({ type: "Power Cut", description: `External power lost (${power}V).` });
        } else if (power >= this.THRESHOLDS.POWER_CUT_VOLTAGE && activeStates.isPowerCut) {
          activeStates.isPowerCut = false;
          localEvents.push({ type: "Power Restored", description: `External power restored (${power}V).` });
        }
      }

      // --- Battery Logic ---
      if (eventCode === 20) {
        activeStates.isLowBattery = true;
        localEvents.push({ type: "Low Battery", description: "Internal battery low (Alarm)." });
      } else if (battery !== undefined) {
        if (battery <= this.THRESHOLDS.LOW_BATTERY_VOLTAGE && !activeStates.isLowBattery) {
          activeStates.isLowBattery = true;
          localEvents.push({ type: "Low Battery", description: `Internal battery low (${battery}V).` });
        } else if (battery >= this.THRESHOLDS.BATTERY_RECOVERY_VOLTAGE && activeStates.isLowBattery) {
          activeStates.isLowBattery = false;
          localEvents.push({ type: "Battery Recovered", description: `Internal battery recovered (${battery}V).` });
        }
      }

      // --- Ignition Logic (Purely Boolean-Based) ---
      if (ignition !== undefined) {
        if (activeStates.isIgnitionOn === null) {
          // Silent initialization on the first point of the route
          activeStates.isIgnitionOn = ignition;
        } else if (ignition === true && activeStates.isIgnitionOn === false) {
          activeStates.isIgnitionOn = true;
          localEvents.push({ type: "Ignition On", description: "Engine ignition turned on." });
        } else if (ignition === false && activeStates.isIgnitionOn === true) {
          activeStates.isIgnitionOn = false;
          localEvents.push({ type: "Ignition Off", description: "Engine ignition turned off." });
        }
      }

      // --- GPS Signal Logic ---
      if (eventCode === 27) {
        activeStates.isGpsLost = true;
        localEvents.push({ type: "GPS Signal Loss", description: "Lost GPS satellite fix (Alarm)." });
      } else if (eventCode === 28) {
        activeStates.isGpsLost = false;
        localEvents.push({ type: "GPS Signal Recovery", description: "Regained GPS satellite fix (Alarm)." });
      } else {
        if (validGps === false && !activeStates.isGpsLost) {
          activeStates.isGpsLost = true;
          localEvents.push({ type: "GPS Signal Loss", description: "Lost GPS satellite fix." });
        } else if (validGps === true && activeStates.isGpsLost) {
          activeStates.isGpsLost = false;
          localEvents.push({ type: "GPS Signal Recovery", description: "Regained GPS satellite fix." });
        }
      }

      // --- GSM Signal Logic ---
      if (gsmSignal !== undefined) {
        if (gsmSignal <= this.THRESHOLDS.GSM_LOW_DBM && !activeStates.isGsmLow) {
          activeStates.isGsmLow = true;
          localEvents.push({ type: "GSM Signal Low", description: `Cellular signal degraded (${gsmSignal} dBm).` });
        } else if (gsmSignal > this.THRESHOLDS.GSM_LOW_DBM && activeStates.isGsmLow) {
          activeStates.isGsmLow = false;
          localEvents.push({ type: "GSM Signal Recovery", description: `Cellular signal restored (${gsmSignal} dBm).` });
        }
      }

      // ==========================================
      // 2. OTHER EXPLICIT Point-in-Time Events
      // ==========================================
      
      // We manually handled these codes above. We MUST keep 3 and 4 in ignoreCodes
      // so the explicit event parser doesn't duplicate them!
      const ignoreCodes = [0, 3, 4, 18, 19, 20, 27, 28, 31]; 
      
      if (eventCode !== undefined && !ignoreCodes.includes(eventCode)) {
        const eventLabel = this.EVENT_CODES[eventCode];
        
        if (eventLabel && this.EVENT_COLORS[eventLabel]) {
          localEvents.push({ type: eventLabel, description: `Triggered event: ${eventLabel}` });
        }
      }

      // ==========================================
      // 3. Evaluate Distance/Time Gap Waypoints
      // ==========================================
      let isThresholdMet = false;
      if (!isStart && !isEnd && localEvents.length === 0 && lastMarkerData) {
        const distanceMeters = this._calculateDistance(lastMarkerData.lat, lastMarkerData.lon, point.latitude, point.longitude);
        const timeDiffMs = Math.abs(pointTime - lastMarkerData.time);
        
        if (distanceMeters >= this.THRESHOLDS.MARKER_DISTANCE_METERS || timeDiffMs >= this.THRESHOLDS.MARKER_TIME_MS) {
          isThresholdMet = true;
        }
      }

      // ==========================================
      // 4. Create Marker & Link Events
      // ==========================================
      const needsMarker = isStart || isEnd || localEvents.length > 0 || isThresholdMet;

      if (needsMarker) {
        const markerId = `marker_${point.id || index}`; 
        
        let markerType = 'Waypoint';
        
        if (isEnd) {
          markerType = 'End';
        } else if (isStart) {
          markerType = 'Start';
        } else if (localEvents.length > 0) {
          markerType = localEvents[0].type; 
        }

        const color = this.EVENT_COLORS[markerType] || this.EVENT_COLORS["Default"];

        let displayLabel = markerType;
        if (markerType === 'Waypoint') {
          displayLabel = this._formatTime(point.fixTime || point.deviceTime);
        }

        markers[markerId] = {
          latlon,
          color,
          bearing: point.course || 0,
          label: displayLabel, 
          type: markerType 
        };

        localEvents.forEach(evt => {
          events.push({
            markerId: markerId, 
            timestamp: point.fixTime,
            latlon,
            type: evt.type,
            description: evt.description,
            color: this.EVENT_COLORS[evt.type] || this.EVENT_COLORS["Default"]
          });
        });

        lastMarkerData = { lat: point.latitude, lon: point.longitude, time: pointTime };
      }
    });

    return { line, markers, events };
  }
}

export default VT100MapProcessor;