// Pure presentation helpers for a device's telemetry. Shared by the device
// list (DeviceCard + the list's filter logic) so the two can't drift. Online
// status is NOT here — that's recency-gated state and lives in the devices
// store (isDeviceOnline).

export const getSignalLevel = (signal) => {
  if (signal === undefined || signal === null) return 'N/A';
  if (signal < 0) {
    if (signal >= -75) return 'Good';
    if (signal >= -95) return 'Fair';
    return 'Low';
  }
  if (signal > 20 || signal >= 4) return 'Good';
  if (signal > 10 || signal >= 2) return 'Fair';
  return 'Low';
};

// Standard Li-ion voltage map (3.7V nominal, 4.2V max).
export const getBatteryPercentage = (val) => {
  if (val === undefined || val === null) return 'N/A';
  const v = Number(val);
  if (isNaN(v)) return 'N/A';
  if (v >= 4.20) return '100%';
  if (v >= 4.10) return '90%';
  if (v >= 4.00) return '80%';
  if (v >= 3.90) return '70%';
  if (v >= 3.80) return '60%';
  if (v >= 3.70) return '50%';
  if (v >= 3.65) return '20%';
  if (v >= 3.60) return '10%';
  return '0%'; // Critical
};

export const getGpsQuality = (device) => {
  const sat = device.sat || 0;
  const hdop = device.hdop || 0;
  const valid = device.valid;

  if (!valid && sat === 0) return { label: 'No Fix', color: 'text-red-500', icon: 'fa-satellite' };
  if (sat < 4 || (hdop > 0 && hdop > 6)) return { label: 'Bad', color: 'text-orange-500', icon: 'fa-satellite' };
  if (sat < 7 || (hdop > 0 && hdop > 2.5)) return { label: 'Fair', color: 'text-yellow-600', icon: 'fa-satellite' };
  if (sat < 12 || (hdop > 0 && hdop > 1)) return { label: 'Good', color: 'text-brand', icon: 'fa-satellite' };
  return { label: 'Excellent', color: 'text-green-600', icon: 'fa-satellite' };
};

export const getWarnings = (device) => {
  const warnings = [];
  if (device.power !== undefined && device.power !== null && device.power < 5) {
    warnings.push('Low Power (< 5V)');
  }
  if (getSignalLevel(device.signalLevel) === 'Low') {
    warnings.push('Weak Network');
  }
  return warnings;
};

export const formatDate = (dateString) => {
  if (!dateString) return 'Waiting for update...';
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};
