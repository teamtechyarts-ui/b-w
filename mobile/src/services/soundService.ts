import {AppState, Platform, Vibration} from 'react-native';

/**
 * Stable in-app notification sound synthesizer and manager.
 * Uses the Web Audio API in web environments and haptic feedback / native vibration fallback.
 * Includes deduplication, burst throttling, mute control, and foreground-only enforcement.
 */

class SoundService {
  private audioCtx: any = null;
  private isUnlocked = false;
  private muted = false;
  private lastPlayedTime = 0;
  private minIntervalMs = 1000; // Prevent noise storms during reconnection
  private seenEvents = new Map<string, number>();
  private readonly maxSeenHistory = 500;
  private readonly eventTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window === 'undefined') return;

    try {
      const AudioContextClass =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();

        // Listen for first user interaction to resume suspended context (browser autoplay policy)
        const unlock = () => {
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
          }
          this.isUnlocked = true;
          window.removeEventListener('click', unlock);
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('keydown', unlock);
        };

        window.addEventListener('click', unlock, {passive: true});
        window.addEventListener('touchstart', unlock, {passive: true});
        window.addEventListener('keydown', unlock, {passive: true});
      }
    } catch (err) {
      // Graceful fallback if Web Audio is unsupported
      this.audioCtx = null;
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * Deduplicate incoming events using a unique eventId, notificationId, or composite key.
   */
  public isDuplicate(key: string): boolean {
    this.cleanupOldEvents();
    if (this.seenEvents.has(key)) {
      return true;
    }
    this.seenEvents.set(key, Date.now());
    return false;
  }

  private cleanupOldEvents() {
    const now = Date.now();
    if (this.seenEvents.size > this.maxSeenHistory) {
      for (const [id, ts] of this.seenEvents.entries()) {
        if (now - ts > this.eventTtlMs || this.seenEvents.size > this.maxSeenHistory) {
          this.seenEvents.delete(id);
        }
      }
    }
  }

  /**
   * Plays a subtle, professional two-tone chime for genuine new notifications.
   */
  public playNotificationSound(options?: {
    id?: string | null;
    eventType?: string | null;
    orderId?: string | null;
    force?: boolean;
  }): boolean {
    if (this.muted) return false;

    // Do not play if app is in background or inactive
    if (AppState.currentState && AppState.currentState !== 'active') {
      return false;
    }

    // Check document visibility on web
    if (typeof document !== 'undefined' && document.hidden) {
      return false;
    }

    const now = Date.now();

    // Deduplication check
    if (!options?.force) {
      const stableKey =
        options?.id ||
        (options?.eventType && options?.orderId
          ? `${options.eventType}_${options.orderId}_${Math.floor(now / 30000)}`
          : null);

      if (stableKey && this.isDuplicate(stableKey)) {
        return false;
      }
    }

    // Interval throttle check to prevent burst noise during reconciliation
    if (now - this.lastPlayedTime < this.minIntervalMs) {
      return false;
    }
    this.lastPlayedTime = now;

    // Web Audio Synthesizer: Elegant two-tone chime (587.33Hz D5 -> 880.00Hz A5)
    if (this.audioCtx) {
      try {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }

        const ctx = this.audioCtx;
        const startTime = ctx.currentTime;

        // Tone 1: 587.33 Hz (D5) for 90ms
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, startTime);
        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.18, startTime + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.09);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(startTime);
        osc1.stop(startTime + 0.095);

        // Tone 2: 880.00 Hz (A5) for 150ms
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880.0, startTime + 0.08);
        gain2.gain.setValueAtTime(0, startTime + 0.08);
        gain2.gain.linearRampToValueAtTime(0.22, startTime + 0.095);
        gain2.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.23);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(startTime + 0.08);
        osc2.stop(startTime + 0.235);
      } catch (err) {
        // Fallback to vibration if audio context fails
        this.triggerVibration();
      }
    } else {
      this.triggerVibration();
    }

    return true;
  }

  private triggerVibration() {
    try {
      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 70, 40, 90]);
      }
    } catch {
      // Safe no-op
    }
  }

  /**
   * Reset deduplication state (useful for test suites).
   */
  public resetForTesting(): void {
    this.seenEvents.clear();
    this.lastPlayedTime = 0;
    this.muted = false;
  }
}

export const soundService = new SoundService();
