#!/bin/bash

echo "🔧 Fixing iOS build issues..."

# Clean build folders
echo "1. Cleaning build folders..."
rm -rf ios/build
rm -rf ios/Pods
rm -rf ios/Podfile.lock

# Clean derived data
echo "2. Cleaning derived data..."
rm -rf ~/Library/Developer/Xcode/DerivedData/*

# Reinstall pods
echo "3. Reinstalling pods..."
cd ios
pod deintegrate
pod install
cd ..

# Clean watchman cache
echo "4. Cleaning watchman cache..."
watchman watch-del-all 2>/dev/null || echo "Watchman not installed, skipping..."

# Clean node modules cache
echo "5. Cleaning Metro bundler cache..."
rm -rf /tmp/metro-* 2>/dev/null || true
rm -rf /tmp/haste-* 2>/dev/null || true

# Reset Metro bundler
echo "6. Resetting Metro bundler..."
yarn start --reset-cache &
METRO_PID=$!
sleep 5
kill $METRO_PID 2>/dev/null || true

echo "✅ Cleanup complete!"
echo ""
echo "Next steps:"
echo "1. Open Xcode workspace: ios/ReactNativeBoilerPlate.xcworkspace"
echo "2. Clean build folder: Product → Clean Build Folder (Cmd+Shift+K)"
echo "3. Build again: Product → Build (Cmd+B)"
echo ""
echo "Or run from terminal:"
echo "  yarn ios"
