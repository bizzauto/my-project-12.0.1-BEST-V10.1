// Mobile Capacitor App Utilities
// This file handles native mobile features when running inside Capacitor

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Share } from '@capacitor/share';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Check if running on native mobile
const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

export const MobileApp = {
  isNative: () => isNative,
  platform: () => platform,
  isAndroid: () => platform === 'android',
  isIOS: () => platform === 'ios',

  // Initialize mobile app
  async init() {
    if (!isNative) return;

    try {
      // Set status bar style
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#0F172A' });

      // Hide splash screen after app is ready
      await SplashScreen.hide();

      // Harden native navigation (hardware back, etc.)
      this.setupNativeNavigation();
    } catch (err) {
      console.error('Mobile init error:', err);
    }
  },

  // Native navigation hardening (no extra plugins required)
  // - Prevents the Android hardware back button from exiting the app on the
  //   first screen, and lets open modals/overlays react to the back gesture.
  setupNativeNavigation() {
    if (!isNative) return;
    try {
      // Seed an extra history entry so the first hardware-back doesn't leave.
      window.history.pushState({ capNative: true }, '');
      window.addEventListener('popstate', () => {
        // Notify listeners (modals/overlays) so they can close themselves.
        window.dispatchEvent(new CustomEvent('mobile-hardware-back'));
        // Re-seed to keep the app alive instead of exiting.
        window.history.pushState({ capNative: true }, '');
      });
    } catch (err) {
      console.log('Native navigation setup error:', err);
    }
  },

  // Share content
  async shareContent(title: string, text: string, url?: string) {
    if (!isNative) {
      // Fallback: use Web Share API
      if (navigator.share) {
        try {
          await navigator.share({ title, text, url });
        } catch (e) {
          // User cancelled
        }
      }
      return;
    }

    try {
      await Share.share({ title, text, url });
    } catch (err) {
      console.error('Share error:', err);
    }
  },

  // Take photo
  async takePhoto(): Promise<string | null> {
    if (!isNative) return null;

    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: 80,
      });
      return photo.dataUrl || null;
    } catch (err) {
      console.error('Camera error:', err);
      return null;
    }
  },

  // Pick from gallery
  async pickImage(): Promise<string | null> {
    if (!isNative) return null;

    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        quality: 80,
      });
      return photo.dataUrl || null;
    } catch (err) {
      console.error('Gallery error:', err);
      return null;
    }
  },

  // Get safe area insets for notches
  getSafeAreaInsets() {
    const style = getComputedStyle(document.documentElement);
    return {
      top: parseInt(style.getPropertyValue('--sat') || '0'),
      bottom: parseInt(style.getPropertyValue('--sab') || '0'),
      left: parseInt(style.getPropertyValue('--sal') || '0'),
      right: parseInt(style.getPropertyValue('--sar') || '0'),
    };
  },

  // Haptic feedback (no-op on web, uses Capacitor Haptics on native)
  async hapticLight() {
    if (!isNative) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch { /* plugin not available */ }
  },

  async hapticMedium() {
    if (!isNative) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch { /* plugin not available */ }
  },

  async hapticSuccess() {
    if (!isNative) return;
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
    } catch { /* plugin not available */ }
  },

  // App info for update prompts / version display
  async getAppInfo() {
    return {
      name: 'BizzAuto',
      version: (import.meta as any).env?.VITE_APP_VERSION || '1.0.0',
      build: (import.meta as any).env?.VITE_APP_BUILD || '0',
      isNative,
      platform,
    };
  },
};

// Export for easy import
export default MobileApp;
