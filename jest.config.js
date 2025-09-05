module.exports = {
  preset: 'react-native',
  setupFiles:["./src/utils/jestSetup.js"],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|react-native-ble-plx|react-native-permissions|@react-navigation|@react-native-community|react-native-size-matters|react-native-vector-icons)/)'
  ]
};
