import {soundService} from './soundService';
import {AppState} from 'react-native';

describe('soundService', () => {
  beforeEach(() => {
    soundService.resetForTesting();
    (AppState as any).currentState = 'active';
  });

  it('plays notification sound for new unique events', () => {
    const played = soundService.playNotificationSound({
      id: 'event-1',
      eventType: 'NOTIFICATION_CREATED',
      orderId: 'order-1',
    });
    expect(played).toBe(true);
  });

  it('suppresses duplicate sounds when same event ID arrives multiple times', () => {
    const first = soundService.playNotificationSound({
      id: 'event-dup-1',
      eventType: 'NOTIFICATION_CREATED',
      orderId: 'order-1',
    });
    expect(first).toBe(true);

    const second = soundService.playNotificationSound({
      id: 'event-dup-1',
      eventType: 'NOTIFICATION_CREATED',
      orderId: 'order-1',
    });
    expect(second).toBe(false);
  });

  it('throttles rapid consecutive sounds to prevent audio bursts', () => {
    const first = soundService.playNotificationSound({
      id: 'burst-1',
      eventType: 'NOTIFICATION_CREATED',
    });
    expect(first).toBe(true);

    // Immediate second event within minIntervalMs (1000ms)
    const second = soundService.playNotificationSound({
      id: 'burst-2',
      eventType: 'NOTIFICATION_CREATED',
    });
    expect(second).toBe(false);
  });

  it('respects mute setting and does not play when muted', () => {
    soundService.setMuted(true);
    expect(soundService.isMuted()).toBe(true);

    const played = soundService.playNotificationSound({
      id: 'event-muted',
      eventType: 'NOTIFICATION_CREATED',
    });
    expect(played).toBe(false);

    soundService.setMuted(false);
    expect(soundService.isMuted()).toBe(false);
  });

  it('does not play when app is in background', () => {
    (AppState as any).currentState = 'background';

    const played = soundService.playNotificationSound({
      id: 'event-bg',
      eventType: 'NOTIFICATION_CREATED',
    });
    expect(played).toBe(false);
  });
});
