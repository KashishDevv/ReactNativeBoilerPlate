
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
// jest.mock('react-native-base64', () =>
//     jest.fn()
// );

// jest.mock('react-native-email', () => ({
//     email: jest.fn(),
// }));

jest.mock('react-native-size-matters', () => ({
    moderateScale: (size) => size, // Mocking moderateScale to just return the input size
    moderateVerticalScale: (size) => size, // Mocking moderateVerticalScale to just return the input size
}));

jest.mock('react-native-device-info', () => ({
    getVersion: jest.fn(() => '1.0.0'), // Mock the getVersion function
}));

jest.mock('@react-native-community/netinfo', () => ({
    NetInfo: jest.fn(), // Mock the NetInfo function
}));

// Mock react-native-permissions to avoid ESM issues and native calls in tests
jest.mock('react-native-permissions', () => {
  const RESULTS = {
    UNAVAILABLE: 'unavailable',
    DENIED: 'denied',
    BLOCKED: 'blocked',
    GRANTED: 'granted',
    LIMITED: 'limited',
  };
  return {
    __esModule: true,
    RESULTS,
    PERMISSIONS: {
      ANDROID: {
        BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
        BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
        BLUETOOTH_ADVERTISE: 'android.permission.BLUETOOTH_ADVERTISE',
        ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
        ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
      },
      IOS: {
        BLUETOOTH_PERIPHERAL: 'ios.permission.BLUETOOTH_PERIPHERAL',
        LOCATION_WHEN_IN_USE: 'ios.permission.LOCATION_WHEN_IN_USE',
      },
    },
    check: jest.fn(async () => RESULTS.GRANTED),
    request: jest.fn(async () => RESULTS.GRANTED),
    openSettings: jest.fn(async () => {}),
  };
});

jest.mock('@react-navigation/native', () => {
    return {
      __esModule: true,
      useNavigation: jest.fn(),
      // You can add other mocked functions and components here if needed
    };
  });

jest.mock('@react-navigation/native-stack', () => ({
    createNativeStackNavigator: jest.fn(),  // Mock the createNativeStackNavigator function
}));

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),   // Mock the useDispatch function
    Provider: jest.fn(),
}));
jest.mock('react-native-splash-screen', () => ({
    SplashScreen: jest.fn(),  // Mock the SplashScreen function
}));
