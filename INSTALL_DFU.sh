#!/bin/bash

# DFU/OTA Installation Script for React Native Smart Health Tag
# This script installs all required dependencies for DFU functionality

echo "════════════════════════════════════════════════════════════"
echo "  🚀 DFU/OTA Installation Script"
echo "  Smart Health Tag - React Native Boilerplate"
echo "════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Install Node dependencies
echo "${BLUE}[1/4]${NC} Installing Node.js dependencies..."
yarn install
if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Node dependencies installed${NC}"
else
    echo "${RED}❌ Failed to install Node dependencies${NC}"
    exit 1
fi
echo ""

# Step 2: Install iOS dependencies
echo "${BLUE}[2/4]${NC} Installing iOS CocoaPods (includes iOSDFULibrary)..."
cd ios
pod install
if [ $? -eq 0 ]; then
    echo "${GREEN}✅ iOS dependencies installed${NC}"
    echo "   • iOSDFULibrary (v4.14.0)"
else
    echo "${RED}❌ Failed to install iOS dependencies${NC}"
    cd ..
    exit 1
fi
cd ..
echo ""

# Step 3: Android Gradle check
echo "${BLUE}[3/4]${NC} Checking Android Gradle configuration..."
if grep -q "no.nordicsemi.android:dfu" android/app/build.gradle; then
    echo "${GREEN}✅ Android DFU library configured${NC}"
    echo "   • no.nordicsemi.android:dfu (v2.3.0)"
else
    echo "${RED}❌ Android DFU library not found in build.gradle${NC}"
    exit 1
fi
echo ""

# Step 4: Clean build folders
echo "${BLUE}[4/4]${NC} Cleaning build folders..."
rm -rf node_modules/.cache
rm -rf ios/build
rm -rf android/app/build
echo "${GREEN}✅ Build folders cleaned${NC}"
echo ""

# Verification
echo "${YELLOW}════════════════════════════════════════════════════════════${NC}"
echo "${GREEN}✅ DFU/OTA Installation Complete!${NC}"
echo "${YELLOW}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📦 Installed Components:"
echo "   ✅ react-native-fs (file operations)"
echo "   ✅ iOSDFULibrary (iOS DFU)"
echo "   ✅ Android-DFU-Library (Android DFU)"
echo ""
echo "🎯 Next Steps:"
echo "   1. Build iOS: ${BLUE}npx react-native run-ios${NC}"
echo "   2. Build Android: ${BLUE}npx react-native run-android${NC}"
echo "   3. Test DFU: Connect to device → Device Details → Firmware Update"
echo ""
echo "📚 Documentation:"
echo "   • DFU_IMPLEMENTATION_GUIDE.md - Complete technical guide"
echo "   • DFU_QUICK_REFERENCE.md - API reference"
echo "   • DFU_INSTALLATION.md - Detailed installation guide"
echo ""
echo "${GREEN}Happy Coding! 🚀${NC}"
echo ""

