import { Capacitor } from '@capacitor/core';
export const baseUrl = "https://api.navitag.net/v1"
export const liqKey = "pk.f34251da8132d1cbfbb1baa7f9925265"

export const getPlatformInfo = () => {
  // Capacitor.getPlatform() returns 'ios', 'android', or 'web'
  const platform = Capacitor.getPlatform();
  
  // Capacitor.isNativePlatform() returns true for ios/android apps, false for web
  const isNative = Capacitor.isNativePlatform(); 

  // Grab the user agent for browser-specific checks
  const ua = navigator.userAgent || navigator.vendor || window.opera;

  // 1. Detect if it's a mobile browser (Safari/Chrome on phone)
  const isMobileWeb = platform === 'web' && /android|iphone|ipad|ipod/i.test(ua);

  // 2. Detect Desktop Web
  const isDesktopWeb = platform === 'web' && !isMobileWeb;

  // 3. Detect In-App Browsers (Facebook, Instagram, Twitter, LinkedIn, etc.)
  // These append specific strings to the User Agent when opening links internally
  const isInAppBrowser = /FBAN|FBAV|Instagram|Twitter|LinkedInApp|Line|MicroMessenger/i.test(ua);

  return {
    platform,         // 'ios', 'android', or 'web'
    isNative,         // true if it's your compiled app downloaded from the App Store / Play Store
    isWeb: platform === 'web', 
    isMobileWeb,      // true if accessed via phone browser
    isDesktopWeb,     // true if accessed via computer browser
    isInAppBrowser,   // true if clicked from a social media app
  };
};