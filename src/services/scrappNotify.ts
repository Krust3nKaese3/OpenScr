/** Title shown for a local notification belongs to one OpenScrapp. */

export const NOTIFICATION_APP_KEY = 'openscrAppId';

export function notificationTitle(appName: string, title: string): string {
  const name = appName.trim() || 'OpenScrapp';
  const prefixed = `${name}: ${title}`;
  return prefixed.length > 180 ? prefixed.slice(0, 180) : prefixed;
}

export function notificationOwnedByApp(data: unknown, appId: string): boolean {
  if (!data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>)[NOTIFICATION_APP_KEY] === appId;
}

export async function cancelScheduledForApp(appId: string): Promise<void> {
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => notificationOwnedByApp(item.content?.data, appId))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}
