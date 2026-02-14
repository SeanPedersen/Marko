#!/bin/bash
set -e

# Load environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "ERROR: .env file not found. Copy .env.example to .env and fill in your credentials."
    exit 1
fi

# Validate required env vars
for var in SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD TEAM_ID; do
    if [ -z "${!var}" ]; then
        echo "ERROR: $var is not set in .env"
        exit 1
    fi
done

# Configuration
APP_NAME="marko"
VERSION=$(node -p "require('./package.json').version")
APP_BUNDLE="${APP_NAME}.app"
BUNDLE_PATH="./src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_BUNDLE}"
ZIP_PATH="./src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_NAME}_${VERSION}_universal.zip"

# Ensure both targets are installed
echo "Checking Rust targets..."
rustup target add x86_64-apple-darwin 2>/dev/null || true
rustup target add aarch64-apple-darwin 2>/dev/null || true

# Build universal binary
echo "Building ${APP_NAME} v${VERSION} (universal)..."
npm run tauri build -- --target universal-apple-darwin

# Verify app exists
if [ ! -d "${BUNDLE_PATH}" ]; then
    echo "ERROR: App not found at ${BUNDLE_PATH}"
    exit 1
fi

# Sign libraries
echo "-Sign libraries"
find "${BUNDLE_PATH}" -type f \( -name "*.so" -o -name "*.dylib" \) -print0 2>/dev/null | while IFS= read -r -d '' file; do
    codesign --force --options runtime --timestamp -s "${SIGNING_IDENTITY}" "$file"
done

# Sign main binary
echo "-Sign main binary"
codesign --force --options runtime --timestamp -s "${SIGNING_IDENTITY}" "${BUNDLE_PATH}/Contents/MacOS/${APP_NAME}"

# Sign app bundle
echo "-Sign app bundle"
codesign --force --options runtime --timestamp -s "${SIGNING_IDENTITY}" "${BUNDLE_PATH}"
codesign -dv --verbose=4 "${BUNDLE_PATH}"

# Create zip for notarization
echo "-Create zip for notarization"
rm -f "${ZIP_PATH}"
ditto -c -k --rsrc --keepParent "${BUNDLE_PATH}" "${ZIP_PATH}"

# Notarization
echo "-Notarize app"
echo "Submitting for notarization..."
SUBMISSION_OUTPUT=$(xcrun notarytool submit "${ZIP_PATH}" --wait --apple-id "${APPLE_ID}" --password "${APPLE_PASSWORD}" --team-id "${TEAM_ID}" 2>&1)
echo "$SUBMISSION_OUTPUT"

# Extract submission ID
SUBMISSION_ID=$(echo "$SUBMISSION_OUTPUT" | grep -E "^\s*id:" | head -1 | awk '{print $2}')

if [ -z "$SUBMISSION_ID" ]; then
    echo "ERROR: Could not extract submission ID"
    exit 1
fi

echo "Checking notarization status (Submission ID: $SUBMISSION_ID)"
STATUS=$(xcrun notarytool info "$SUBMISSION_ID" --apple-id "${APPLE_ID}" --password "${APPLE_PASSWORD}" --team-id "${TEAM_ID}")
echo "$STATUS"

if echo "$STATUS" | grep -q "status: Accepted"; then
    echo "Notarization accepted! Stapling the app..."
    xcrun stapler staple "${BUNDLE_PATH}"
    rm -f "${ZIP_PATH}"
    ditto -c -k --rsrc --keepParent "${BUNDLE_PATH}" "${ZIP_PATH}"
    echo "Done - ready to deploy: ${ZIP_PATH}"
fi

if echo "$STATUS" | grep -q "status: Invalid"; then
    echo "Notarization FAILED! Fetching log..."
    xcrun notarytool log "$SUBMISSION_ID" --apple-id "${APPLE_ID}" --password "${APPLE_PASSWORD}" --team-id "${TEAM_ID}"
    exit 1
fi

# Notification
title="BUILD COMPLETE"
message="Marko v${VERSION} build is complete"
osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null
afplay /System/Library/Sounds/Glass.aiff 2>/dev/null
