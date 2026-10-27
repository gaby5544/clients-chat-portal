#!/bin/bash
# Rebuilds public/downloads/Vistra-Setup.exe on Ubuntu/Debian:
#   apt-get install -y gcc-mingw-w64-x86-64-win32 binutils-mingw-w64-x86-64 nsis
set -e; cd "$(dirname "$0")"
x86_64-w64-mingw32-windres res.rc -O coff -o res.o
x86_64-w64-mingw32-gcc -mwindows -O2 -s -static launcher.c res.o -o Vistra.exe
makensis -V1 installer.nsi && mv Vistra-Setup.exe ../public/downloads/Vistra-Setup.exe && echo "Built public/downloads/Vistra-Setup.exe"
