// 📲 Push notifications in the Android app (Firebase Cloud Messaging, via @capacitor/push-notifications).
// After log-in: ask permission → get this phone's token → send it to the server (POST /api/notifications/devices).
// Tapping a notification opens its page. Log-out removes the phone (no pushes for the next person on it).
//
// Switched on with VITE_PUSH=on in client/.env.android, once Firebase's google-services.json is in
// client/android/app/ (registering without it crashes Android apps, so it stays off until then).
import { isNative } from './platform';

const ENABLED = isNative && import.meta.env.VITE_PUSH === 'on';
let started = false;
let deviceToken = null;

// open a page inside the app (React Router follows the history change)
const open = (link) => {
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return;
  window.history.pushState({}, '', link);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export async function startPush(api) {
  if (!ENABLED || started) return;
  started = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;
    await PushNotifications.createChannel({ id: 'kapu', name: 'Orders, chats & deliveries', description: 'Order updates, new messages, your rider’s progress', importance: 4, visibility: 1 }).catch(() => {});
    await PushNotifications.addListener('registration', ({ value }) => {
      deviceToken = value;
      api.post('/notifications/devices', { token: value, platform: 'android' }).catch(() => {});
    });
    await PushNotifications.addListener('registrationError', (error) => console.warn('[push] registration failed', error?.error));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => open(notification?.data?.link));
    await PushNotifications.register();
  } catch (error) {
    started = false;
    console.warn('[push] not available', error?.message);
  }
}

// before logging out: this phone stops getting this person's notifications
export async function stopPush(api) {
  if (!ENABLED || !deviceToken) return;
  await api.delete('/notifications/devices', { data: { token: deviceToken } }).catch(() => {});
}
