#!/bin/bash
# Builds the signed Vistra Android app (v1.1, with fingerprint unlock) using the standard Android SDK.
# Used by the GitHub build (.github/workflows/build-android.yml), and works on any computer that has the Android SDK + Java 17+.
#
#   ANDROID_HOME=/path/to/sdk KEYSTORE=/path/vistra.keystore KEYPASS='…' ./build-sdk.sh
#
# Result: ../public/downloads/Vistra.apk   (the keystore is NOT stored in this repository)
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -d "$SDK" ] || { echo "Set ANDROID_HOME to your Android SDK folder."; exit 1; }
: "${KEYSTORE:?Set KEYSTORE to the signing key file}"; : "${KEYPASS:?Set KEYPASS to its password}"
ALIAS="${KEY_ALIAS:-vistra}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
JAR="$SDK/platforms/android-34/android.jar"
[ -f "$JAR" ] || JAR="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)/android.jar"
echo "Using build-tools $(basename "$BT") and $(basename "$(dirname "$JAR")")"
rm -rf build && mkdir -p build/gen build/classes
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/app-unsigned.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen \
  --min-sdk-version 21 --target-sdk-version 34 --auto-add-overlay build/res.zip
javac --release 8 -encoding UTF-8 -Xlint:-options -cp "$JAR" -d build/classes src/com/vistra/desk/*.java build/gen/com/vistra/desk/R.java
"$BT/d8" --release --min-api 21 --lib "$JAR" --output build $(find build/classes -name '*.class')
(cd build && zip -q -j app-unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/app-unsigned.apk build/app-aligned.apk
mkdir -p ../public/downloads
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass pass:"$KEYPASS" --key-pass pass:"$KEYPASS" \
  --out ../public/downloads/Vistra.apk build/app-aligned.apk
"$BT/apksigner" verify --print-certs ../public/downloads/Vistra.apk | head -3
# Safety checks: the new app must really contain the fingerprint pieces.
"$BT/aapt2" dump permissions ../public/downloads/Vistra.apk | grep -q USE_BIOMETRIC || { echo "Fingerprint permission missing"; exit 1; }
unzip -p ../public/downloads/Vistra.apk classes.dex | grep -aq "VistraBio" || { echo "Fingerprint bridge missing from the app"; exit 1; }
rm -rf build
echo "Built public/downloads/Vistra.apk  ($(du -h ../public/downloads/Vistra.apk | cut -f1))"
