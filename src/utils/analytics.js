import { FirebaseAnalytics } from '@capacitor-firebase/analytics';

/**
 * Centered analytics instance following the pattern used in auth.js
 */
export const analytics = FirebaseAnalytics;

/**
 * ------------------------------------------------------------------
 * Analytics Utility Functions
 * ------------------------------------------------------------------
 */

export const setUserId = async (userId) => {
  await FirebaseAnalytics.setUserId({
    userId: userId,
  });
};

export const setUserProperty = async (key, value) => {
  await FirebaseAnalytics.setUserProperty({
    key: key,
    value: value,
  });
};

export const setCurrentScreen = async (screenName, screenClassOverride = null) => {
  await FirebaseAnalytics.setCurrentScreen({
    screenName: screenName,
    screenClassOverride: screenClassOverride,
  });
};

export const logEvent = async (name, params = {}) => {
  await FirebaseAnalytics.logEvent({
    name: name,
    params: params,
  });
};

export const setSessionTimeoutDuration = async (duration) => {
  await FirebaseAnalytics.setSessionTimeoutDuration({
    duration: String(duration),
  });
};

export const setEnabled = async (enabled) => {
  await FirebaseAnalytics.setEnabled({
    enabled: enabled,
  });
};

export const isEnabled = async () => {
  const { enabled } = await FirebaseAnalytics.isEnabled();
  return enabled;
};

export const resetAnalyticsData = async () => {
  await FirebaseAnalytics.resetAnalyticsData();
};

/**
 * ------------------------------------------------------------------
 * On-Device Conversion Utilities
 * ------------------------------------------------------------------
 */

export const initiateOnDeviceConversionWithEmail = async (emailAddress) => {
  await FirebaseAnalytics.initiateOnDeviceConversionMeasurementWithEmailAddress({
    emailAddress,
  });
};

export const initiateOnDeviceConversionWithPhoneNumber = async (phoneNumber) => {
  await FirebaseAnalytics.initiateOnDeviceConversionMeasurementWithPhoneNumber({
    phoneNumber,
  });
};

export const initiateOnDeviceConversionWithHashedEmail = async (emailAddressToHash) => {
  await FirebaseAnalytics.initiateOnDeviceConversionMeasurementWithHashedEmailAddress({
    emailAddressToHash,
  });
};

export const initiateOnDeviceConversionWithHashedPhoneNumber = async (phoneNumberToHash) => {
  await FirebaseAnalytics.initiateOnDeviceConversionMeasurementWithHashedPhoneNumber({
    phoneNumberToHash,
  });
};