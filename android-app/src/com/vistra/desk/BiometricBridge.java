package com.vistra.desk;

import android.app.Activity;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.nio.charset.Charset;
import java.security.Key;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Fingerprint unlock for the Vistra app.
 *
 * The website cannot reach the phone's fingerprint sensor from inside an Android WebView, so this class does it natively and
 * hands the website an answer shaped exactly like a browser's WebAuthn answer (see BioCrypto). The private key is created inside
 * the phone's Android Keystore (hardware-backed where the phone has it), can only sign after a real fingerprint check, can never
 * be exported, and is destroyed by Android if the phone's fingerprints change. Only the PUBLIC key ever leaves the phone.
 *
 * JavaScript talks to it as window.VistraBio: status(), has(id), remove(id), register(reqId, json), authenticate(reqId, json).
 * Slow calls answer later by calling window.__vistraBio(reqId, json).
 * Needs Android 9 (API 28) or newer. On older phones status() says so and the website simply keeps using the PIN.
 */
public final class BiometricBridge {
    private static final String KS = "AndroidKeyStore";
    private static final String PREFIX = "vistra_bio_";
    private static final String PREFS = "vistra_bio";
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private final Activity act;
    private final WebView web;
    private final String host;
    private CancellationSignal cancel;

    public BiometricBridge(Activity activity, WebView webView, String siteHost) {
        this.act = activity;
        this.web = webView;
        this.host = siteHost;
    }

    // ---------------------------------------------------------------- what JavaScript can call

    /** {"supported":bool,"reason":"ready|old_android|no_sensor|not_enrolled|unavailable"} */
    @JavascriptInterface
    public String status() {
        String reason = state();
        JSONObject o = new JSONObject();
        try {
            o.put("supported", "ready".equals(reason));
            o.put("reason", reason);
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** Does this phone still hold the key for that fingerprint registration? */
    @JavascriptInterface
    public boolean has(String credentialId) {
        try {
            if (!validId(credentialId)) return false;
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            return ks.containsAlias(PREFIX + credentialId);
        } catch (Exception e) {
            return false;
        }
    }

    /** Forget a fingerprint registration on this phone (the website has already removed it from the account). */
    @JavascriptInterface
    public boolean remove(String credentialId) {
        try {
            if (!validId(credentialId)) return false;
            deleteKey(credentialId);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Turn fingerprint unlock on: make a key, check the person's fingerprint once, return the public key. */
    @JavascriptInterface
    public void register(final String reqId, final String json) {
        act.runOnUiThread(new Runnable() {
            public void run() {
                try {
                    doRegister(reqId, json);
                } catch (Throwable t) {
                    fail(reqId, "error");
                }
            }
        });
    }

    /** Unlock: check the person's fingerprint and sign the server's challenge with the key. */
    @JavascriptInterface
    public void authenticate(final String reqId, final String json) {
        act.runOnUiThread(new Runnable() {
            public void run() {
                try {
                    doAuthenticate(reqId, json);
                } catch (Throwable t) {
                    fail(reqId, "error");
                }
            }
        });
    }

    // ---------------------------------------------------------------- implementation

    private String state() {
        if (Build.VERSION.SDK_INT < 28) return "old_android";
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                BiometricManager bm = act.getSystemService(BiometricManager.class);
                if (bm == null) return "no_sensor";
                int r = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
                if (r == BiometricManager.BIOMETRIC_SUCCESS) return "ready";
                if (r == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "not_enrolled";
                if (r == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) return "unavailable";
                return "no_sensor";
            }
            FingerprintManager fm = act.getSystemService(FingerprintManager.class);
            if (fm == null || !fm.isHardwareDetected()) return "no_sensor";
            return fm.hasEnrolledFingerprints() ? "ready" : "not_enrolled";
        } catch (Throwable t) {
            return "unavailable";
        }
    }

    /** Only our own site, over https, may use the sensor (UI thread). */
    private boolean pageOk() {
        String u = web.getUrl();
        if (u == null) return false;
        Uri p = Uri.parse(u);
        return "https".equals(p.getScheme()) && host.equals(p.getHost());
    }

    /** The request must be for our own site and the right kind of ceremony; we never sign anything else. */
    private boolean requestOk(String rpId, String clientData, String type) {
        return pageOk() && host.equals(rpId) && clientData != null && clientData.length() < 2000
            && clientData.contains("\"type\":\"" + type + "\"")
            && clientData.contains("\"origin\":\"https://" + host + "\"");
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{16,64}");
    }

    private void doRegister(String reqId, String json) throws Exception {
        JSONObject o = new JSONObject(json);
        final String rpId = o.getString("rpId");
        final String clientData = o.getString("clientDataJSON");
        if (!requestOk(rpId, clientData, "webauthn.create")) { fail(reqId, "blocked"); return; }
        if (!"ready".equals(state())) { fail(reqId, "unsupported"); return; }

        byte[] raw = new byte[16];
        new SecureRandom().nextBytes(raw);
        final String id = BioCrypto.b64u(raw);

        KeyPair kp;
        try {
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KS);
            KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(PREFIX + id, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)          // every signature needs a fingerprint
                .setInvalidatedByBiometricEnrollment(true);   // a new fingerprint added later cancels the key
            if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            g.initialize(b.build());
            kp = g.generateKeyPair();
        } catch (Exception e) {
            fail(reqId, "error");
            return;
        }
        final byte[] pub = kp.getPublic().getEncoded();      // X.509 SubjectPublicKeyInfo, what the server expects

        final Signature sig;
        try {
            sig = Signature.getInstance("SHA256withECDSA");
            sig.initSign((PrivateKey) loadKey(id));
        } catch (Exception e) {
            deleteKey(id);
            fail(reqId, "error");
            return;
        }
        final byte[] cd = clientData.getBytes(UTF8);
        final String reqIdF = reqId;
        prompt("Turn on fingerprint unlock", "Confirm with your fingerprint", sig, reqId, new Result() {
            public void ok(Signature s) {
                try {
                    s.update(BioCrypto.signedPayload(BioCrypto.authData(rpId, 0), cd)); // finish the operation; proves the key works
                    s.sign();
                    JSONObject r = new JSONObject();
                    r.put("ok", true);
                    r.put("credentialId", id);
                    r.put("publicKey", BioCrypto.b64u(pub));
                    r.put("clientDataJSON", BioCrypto.b64u(cd));
                    reply(reqIdF, r);
                } catch (Exception e) {
                    deleteKeyQuietly(id);
                    BiometricBridge.this.fail(reqIdF, "error");
                }
            }

            public void fail(String code) {
                deleteKeyQuietly(id);
                BiometricBridge.this.fail(reqIdF, code);
            }
        });
    }

    private void doAuthenticate(String reqId, String json) throws Exception {
        JSONObject o = new JSONObject(json);
        final String id = o.getString("credentialId");
        final String rpId = o.getString("rpId");
        final String clientData = o.getString("clientDataJSON");
        if (!validId(id) || !requestOk(rpId, clientData, "webauthn.get")) { fail(reqId, "blocked"); return; }
        if (!"ready".equals(state())) { fail(reqId, "unsupported"); return; }

        Key key = loadKey(id);
        if (key == null) { fail(reqId, "nokey"); return; }
        final Signature sig = Signature.getInstance("SHA256withECDSA");
        try {
            sig.initSign((PrivateKey) key);
        } catch (KeyPermanentlyInvalidatedException e) {
            deleteKey(id);                                    // the phone's fingerprints changed: the key is dead on purpose
            fail(reqId, "invalidated");
            return;
        }
        final byte[] cd = clientData.getBytes(UTF8);
        final String reqIdF = reqId;
        prompt("Unlock Vistra", "Use your fingerprint", sig, reqId, new Result() {
            public void ok(Signature s) {
                try {
                    SharedPreferences sp = act.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
                    long ctr = BioCrypto.nextCounter(sp.getLong("ctr_" + id, 0L), System.currentTimeMillis() / 1000L);
                    byte[] ad = BioCrypto.authData(rpId, ctr);
                    s.update(BioCrypto.signedPayload(ad, cd));
                    byte[] sg = s.sign();                      // ASN.1 DER ECDSA, the format WebAuthn uses
                    sp.edit().putLong("ctr_" + id, ctr).apply();
                    JSONObject r = new JSONObject();
                    r.put("ok", true);
                    r.put("credentialId", id);
                    r.put("authenticatorData", BioCrypto.b64u(ad));
                    r.put("clientDataJSON", BioCrypto.b64u(cd));
                    r.put("signature", BioCrypto.b64u(sg));
                    reply(reqIdF, r);
                } catch (Exception e) {
                    BiometricBridge.this.fail(reqIdF, "error");
                }
            }

            public void fail(String code) {
                BiometricBridge.this.fail(reqIdF, code);
            }
        });
    }

    private interface Result {
        void ok(Signature signed);

        void fail(String code);
    }

    /** Shows Android's own fingerprint sheet. It answers exactly once. */
    private void prompt(String title, String subtitle, Signature sig, String reqId, final Result res) {
        if (cancel != null) cancel.cancel();
        cancel = new CancellationSignal();
        final AtomicBoolean done = new AtomicBoolean(false);
        Executor ex = act.getMainExecutor();
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(act)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButton("Use PIN instead", ex, new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int which) {
                    if (done.compareAndSet(false, true)) res.fail("cancelled");
                }
            });
        if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        b.build().authenticate(new BiometricPrompt.CryptoObject(sig), cancel, ex, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                if (!done.compareAndSet(false, true)) return;
                res.ok(r.getCryptoObject().getSignature());
            }

            @Override
            public void onAuthenticationError(int code, CharSequence msg) {
                if (!done.compareAndSet(false, true)) return;
                // 5 = cancelled by the system, 10 = cancelled by the person, 7 / 9 = too many wrong tries
                res.fail(code == 7 || code == 9 ? "lockout" : (code == 5 || code == 10) ? "cancelled" : "error");
            }
            // onAuthenticationFailed (a finger that did not match) is left alone: Android lets the person try again.
        });
    }

    private Key loadKey(String id) throws Exception {
        KeyStore ks = KeyStore.getInstance(KS);
        ks.load(null);
        return ks.getKey(PREFIX + id, null);
    }

    private void deleteKey(String id) throws Exception {
        KeyStore ks = KeyStore.getInstance(KS);
        ks.load(null);
        if (ks.containsAlias(PREFIX + id)) ks.deleteEntry(PREFIX + id);
        act.getSharedPreferences(PREFS, Activity.MODE_PRIVATE).edit().remove("ctr_" + id).apply();
    }

    private void deleteKeyQuietly(String id) {
        try {
            deleteKey(id);
        } catch (Exception ignored) { }
    }

    private void fail(String reqId, String code) {
        try {
            JSONObject r = new JSONObject();
            r.put("ok", false);
            r.put("code", code);
            reply(reqId, r);
        } catch (Exception ignored) { }
    }

    private void reply(String reqId, JSONObject r) {
        final String js = "window.__vistraBio&&window.__vistraBio(" + JSONObject.quote(reqId) + "," + JSONObject.quote(r.toString()) + ")";
        act.runOnUiThread(new Runnable() {
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }
}
