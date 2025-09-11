import { checkNotifications, requestNotifications } from 'react-native-permissions';

export const handleNotificationPermission = async () => {
  const { status, settings } = await checkNotifications();

  if (status === 'granted') {
    console.log('Notifications already allowed');
    return;
  }

  if (status === 'denied' || status === 'blocked') {
    console.log('Notifications denied or blocked, requesting...');
    const { status: newStatus, settings: newSettings } = await requestNotifications([
      'alert',
      'sound',
      'badge',
    ]);
    console.log('New status:', newStatus, newSettings);
  }
};

export default handleNotificationPermission;