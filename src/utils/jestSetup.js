
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
