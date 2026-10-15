#include <windows.h>
#include <stdio.h>

/* Vistra launcher: opens the secure transaction desk in its own app window (Microsoft Edge / Chrome "app mode"). */
static const char *URL = "https://vistra--clientchat--wbl88rcbnqsq.code.run/?source=windows";

static int try_app(const char *exe) {
    char args[1200];
    snprintf(args, sizeof args, "--app=%s --window-size=1280,860", URL);
    HINSTANCE r = ShellExecuteA(NULL, "open", exe, args, NULL, SW_SHOWNORMAL);
    return (INT_PTR)r > 32;
}

int WINAPI WinMain(HINSTANCE h, HINSTANCE p, LPSTR cmd, int show) {
    if (try_app("msedge.exe")) return 0;
    if (try_app("chrome.exe")) return 0;
    if (try_app("brave.exe")) return 0;
    ShellExecuteA(NULL, "open", URL, NULL, NULL, SW_SHOWNORMAL);   /* last resort: default browser */
    return 0;
}
