# React Native Boilerplate

A comprehensive React Native boilerplate project with Redux Toolkit, React Navigation, API integration, and native module support. This project is bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

## 🚀 Features

- **Redux Toolkit** - State management with Redux Toolkit and Redux Persist
- **React Navigation** - Navigation with Native Stack, Bottom Tabs, Drawer, and Material Top Tabs support
- **API Integration** - Axios-based API configuration with interceptors
- **Native Modules** - TypeScript-based native module bridging for iOS and Android
- **Theme System** - Centralized theme management with Colors, Fonts, and Metrics
- **Network Monitoring** - Real-time network connection status monitoring
- **Async Storage** - Persistent storage for Redux state
- **Splash Screen** - Native splash screen integration
- **TypeScript Support** - TypeScript configuration for type safety
- **Jest Testing** - Testing setup with Jest

## 📋 Prerequisites

- Node.js >= 20
- React Native development environment set up ([Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment))
- iOS: Xcode and CocoaPods
- Android: Android Studio and JDK

## 🏗️ Project Structure

```
src/
├── assets/              # Images, fonts, and other static assets
│   ├── fonts/          # Custom fonts
│   └── Appicon.png
├── components/          # Reusable UI components
│   ├── CustomButon.js
│   └── Header.js
├── constants/           # App-wide constants
│   ├── Constants.js
│   ├── NavigationRoutes.js
│   └── Urls.js
├── feature/            # Redux slices and store configuration
│   ├── counterSlice/
│   ├── fetchSlice/
│   ├── reducers/
│   └── Store.js
├── native-modules/     # Native module TypeScript definitions
│   └── NativeBridgingCodeModule.ts
├── navigation/         # Navigation configuration
│   ├── MainNavigation.js
│   └── StackNavigation/
│       ├── AuthStack.js
│       └── HomeStack.js
├── screens/           # Screen components
│   ├── Counter/
│   └── Welcome/
├── theme/             # Theme configuration
│   ├── Colors.js
│   ├── Fonts.js
│   ├── Metrics.js
│   └── Theme.js
└── utils/             # Utility functions
    ├── apiConfig.js
    ├── ConfigAxios.js
    ├── ConnectionInfo.js
    ├── jestSetup.js
    └── NavigationServices.js
```

## 🚀 Getting Started

### Step 1: Install Dependencies

```sh
# Using npm
npm install

# OR using Yarn
yarn install
```

### Step 2: Install iOS Dependencies

For iOS, you need to install CocoaPods dependencies. The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
cd ios && bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

Alternatively, use the provided helper script:

```sh
cd ios && ./pod-install.sh
```

### Step 3: Start Metro

Start the Metro bundler:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

### Step 4: Build and Run

With Metro running, open a new terminal window/pane and run:

#### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

#### iOS

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

The iOS script is configured to run on iPhone 17 Pro simulator by default. You can modify this in `package.json` if needed.

## 📱 Key Features Explained

### Redux Store Configuration

The app uses Redux Toolkit with Redux Persist for state management. The store is configured in `src/feature/Store.js` with:
- AsyncStorage for persistence
- Redux Logger middleware for debugging
- Serializable check disabled for Redux Persist compatibility

### Navigation Structure

The app uses React Navigation with:
- **MainNavigation** - Root navigation container
- **HomeStack** - Main app navigation stack
- **AuthStack** - Authentication flow (ready for implementation)

Navigation routes are centralized in `src/constants/NavigationRoutes.js`.

### API Configuration

API calls are configured using Axios:
- Base URL configuration in `src/constants/Urls.js`
- Axios instance in `src/utils/ConfigAxios.js`
- API methods in `src/utils/apiConfig.js`

### Native Modules

The project includes TypeScript definitions for native modules in `src/native-modules/NativeBridgingCodeModule.ts`. Native implementations are available for:
- iOS: String passing, API calls, image classification
- Android: Toast messages, payment examples, API calls

### Theme System

Centralized theme management:
- Colors: `src/theme/Colors.js`
- Fonts: `src/theme/Fonts.js`
- Metrics: `src/theme/Metrics.js` (responsive sizing)
- Theme: `src/theme/Theme.js` (light/dark theme support)

### Network Monitoring

The app includes `ConnectionInfo` component that monitors network connectivity using `@react-native-community/netinfo`.

## 🧪 Testing

Run tests with:

```sh
# Using npm
npm test

# OR using Yarn
yarn test
```

## 🛠️ Available Scripts

- `npm start` / `yarn start` - Start Metro bundler
- `npm run android` / `yarn android` - Run Android app
- `npm run ios` / `yarn ios` - Run iOS app
- `npm test` / `yarn test` - Run tests
- `npm run lint` / `yarn lint` - Run ESLint

## 🔄 Hot Reloading

The app supports Fast Refresh. When you save changes, the app will automatically update. To forcefully reload:

- **Android**: Press <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu** (<kbd>Ctrl</kbd> + <kbd>M</kbd> on Windows/Linux, <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> on macOS)
- **iOS**: Press <kbd>R</kbd> in iOS Simulator

## 🐛 Troubleshooting

### OpenSSL Certificate Issues on macOS

If you encounter OpenSSL certificate errors when running `bundle install` or `pod install` (errors like `X509_LOOKUP_load_file: BIO lib` or `Could not verify the SSL certificate`), this is typically due to Homebrew Ruby not finding the OpenSSL certificates.

**Solution:** Set the SSL certificate environment variables before running bundle or pod commands:

```sh
export SSL_CERT_FILE=/opt/homebrew/etc/openssl@3/cert.pem
export SSL_CERT_DIR=/opt/homebrew/etc/openssl@3/certs
bundle install
cd ios && bundle exec pod install
```

To make this permanent, add these lines to your `~/.zshrc` or `~/.bash_profile`:

```sh
export SSL_CERT_FILE=/opt/homebrew/etc/openssl@3/cert.pem
export SSL_CERT_DIR=/opt/homebrew/etc/openssl@3/certs
```

### Common Issues

- **Metro bundler cache issues**: Clear cache with `npm start -- --reset-cache` or `yarn start --reset-cache`
- **iOS build issues**: Clean build folder in Xcode (Product → Clean Build Folder) and reinstall pods
- **Android build issues**: Clean gradle cache with `cd android && ./gradlew clean`

For more troubleshooting help, see the [React Native Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

## 📚 Learn More

- [React Native Website](https://reactnative.dev) - Learn more about React Native
- [Getting Started](https://reactnative.dev/docs/environment-setup) - Overview of React Native and environment setup
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - Guided tour of React Native basics
- [React Navigation](https://reactnavigation.org) - Navigation library documentation
- [Redux Toolkit](https://redux-toolkit.js.org) - Redux Toolkit documentation
- [Blog](https://reactnative.dev/blog) - Latest official React Native blog posts
- [`@facebook/react-native`](https://github.com/facebook/react-native) - React Native GitHub repository

## 📄 License

This project is private and proprietary.
