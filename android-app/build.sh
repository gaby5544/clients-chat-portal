#!/bin/bash
# Rebuilds Vistra.apk (Ubuntu/Debian):  apt-get install -y aapt apksigner zipalign dalvik-exchange libandroid-23-java ecj openjdk-21-jre-headless
# Usage: KEYSTORE=/path/vistra.keystore KEYPASS='…' ./build.sh      (the keystore is NOT stored in this repository)
set -e; cd "$(dirname "$0")"; AJ=/usr/share/java/com.android.android-23.jar
rm -rf build && mkdir -p build/gen build/classes
aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I $AJ --target-sdk-version 34 --min-sdk-version 21 --version-code 1 --version-name 1.0 -F build/app-unsigned.apk
ecj -1.7 -proc:none -nowarn -cp $AJ -d build/classes src/com/vistra/desk/MainActivity.java build/gen/com/vistra/desk/R.java
dalvik-exchange --dex --output=build/classes.dex build/classes
(cd build && aapt add app-unsigned.apk classes.dex >/dev/null && zipalign -f 4 app-unsigned.apk app-aligned.apk)
apksigner sign --ks "$KEYSTORE" --ks-key-alias vistra --ks-pass pass:"$KEYPASS" --key-pass pass:"$KEYPASS" --out ../../public/downloads/Vistra.apk build/app-aligned.apk
apksigner verify ../../public/downloads/Vistra.apk && echo "Built public/downloads/Vistra.apk"
