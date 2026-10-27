package com.vistra.desk;

import java.security.MessageDigest;

/**
 * The pure-Java part of fingerprint unlock (no Android classes, so it can be unit-tested on any JDK).
 * It builds exactly what a WebAuthn authenticator returns, so the Vistra server can verify the phone's answer with the same
 * code it uses for browsers: signature = ECDSA-P256-SHA256 over  authenticatorData || SHA-256(clientDataJSON).
 */
final class BioCrypto {
    private BioCrypto() { }

    private static final char[] B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();

    /** Flags byte: bit0 = user present, bit2 = user verified (the fingerprint). */
    static final int FLAGS_UP_UV = 0x05;

    static String b64u(byte[] in) {
        StringBuilder sb = new StringBuilder((in.length * 4 + 2) / 3);
        int i = 0;
        for (; i + 2 < in.length; i += 3) {
            int n = ((in[i] & 0xff) << 16) | ((in[i + 1] & 0xff) << 8) | (in[i + 2] & 0xff);
            sb.append(B64[(n >> 18) & 63]).append(B64[(n >> 12) & 63]).append(B64[(n >> 6) & 63]).append(B64[n & 63]);
        }
        int left = in.length - i;
        if (left == 1) {
            int n = (in[i] & 0xff) << 16;
            sb.append(B64[(n >> 18) & 63]).append(B64[(n >> 12) & 63]);
        } else if (left == 2) {
            int n = ((in[i] & 0xff) << 16) | ((in[i + 1] & 0xff) << 8);
            sb.append(B64[(n >> 18) & 63]).append(B64[(n >> 12) & 63]).append(B64[(n >> 6) & 63]);
        }
        return sb.toString();
    }

    static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** rpIdHash (32) | flags (1) | signCount (4, big-endian) = 37 bytes. */
    static byte[] authData(String rpId, long counter) {
        byte[] out = new byte[37];
        byte[] h = sha256(rpId.getBytes(java.nio.charset.Charset.forName("UTF-8")));
        System.arraycopy(h, 0, out, 0, 32);
        out[32] = (byte) FLAGS_UP_UV;
        out[33] = (byte) (counter >>> 24);
        out[34] = (byte) (counter >>> 16);
        out[35] = (byte) (counter >>> 8);
        out[36] = (byte) counter;
        return out;
    }

    /** What the phone's key signs: authenticatorData || SHA-256(clientDataJSON bytes). */
    static byte[] signedPayload(byte[] authData, byte[] clientDataUtf8) {
        byte[] h = sha256(clientDataUtf8);
        byte[] out = new byte[authData.length + h.length];
        System.arraycopy(authData, 0, out, 0, authData.length);
        System.arraycopy(h, 0, out, authData.length, h.length);
        return out;
    }

    /** The server needs the counter to go up every time. Seconds since 1970 also survive a cleared app, and we never go backwards. */
    static long nextCounter(long previous, long nowSeconds) {
        long n = Math.max(previous + 1, nowSeconds);
        return n > 0xFFFFFFFFL ? 0xFFFFFFFFL : n;
    }
}
