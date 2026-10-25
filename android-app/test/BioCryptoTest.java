package com.vistra.desk;

import java.security.*;
import java.security.spec.ECGenParameterSpec;

/** Makes a registration + a login answer exactly like the app does, so test/bio_native_check.js can verify them with the real server code. */
public class BioCryptoTest {
    public static void main(String[] a) throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair kp = g.generateKeyPair();
        String rp = "vistra.example.com";
        String origin = "https://" + rp;
        String regCh = "Y2hhbGxlbmdlLWNoYWxsZW5nZS1jaGFsbGVuZ2U", authCh = "YXV0aC1jaGFsbGVuZ2UtYXV0aC1jaGFsbGVuZ2U";
        byte[] id = new byte[16]; for (int i = 0; i < 16; i++) id[i] = (byte) (i * 7 + 3);
        String regCd = "{\"type\":\"webauthn.create\",\"challenge\":\"" + regCh + "\",\"origin\":\"" + origin + "\",\"crossOrigin\":false}";
        String authCd = "{\"type\":\"webauthn.get\",\"challenge\":\"" + authCh + "\",\"origin\":\"" + origin + "\",\"crossOrigin\":false}";
        byte[] ad = BioCrypto.authData(rp, BioCrypto.nextCounter(0, 1790000000L));
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign(kp.getPrivate());
        s.update(BioCrypto.signedPayload(ad, authCd.getBytes("UTF-8")));
        byte[] sig = s.sign();
        // a second answer with the SAME clock second must still go up
        long c2 = BioCrypto.nextCounter(BioCrypto.nextCounter(0, 1790000000L), 1790000000L);
        check(c2 == 1790000001L, "counter goes up within one second");
        check(BioCrypto.nextCounter(5, 0) == 6, "counter never goes backwards if the clock is wrong");
        check(BioCrypto.nextCounter(0xFFFFFFFFL, 1) == 0xFFFFFFFFL, "counter is capped at 32 bits");
        check(BioCrypto.b64u(new byte[0]).equals(""), "b64u empty");
        check(BioCrypto.b64u(new byte[]{(byte) 0xfb, (byte) 0xff}).equals("-_8"), "b64u uses url-safe characters, no padding");
        check(BioCrypto.b64u("any carnal pleas".getBytes("UTF-8")).equals(java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("any carnal pleas".getBytes("UTF-8"))), "b64u matches the JDK encoder");
        for (int n = 0; n < 40; n++) { byte[] r = new byte[n]; new SecureRandom().nextBytes(r); check(BioCrypto.b64u(r).equals(java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(r)), "b64u length " + n); }
        check(ad.length == 37 && (ad[32] & 5) == 5, "authenticator data is 37 bytes with user-present + user-verified");
        System.out.println("{\"rp\":\"" + rp + "\",\"origin\":\"" + origin + "\",\"id\":\"" + BioCrypto.b64u(id) + "\",\"pub\":\"" + BioCrypto.b64u(kp.getPublic().getEncoded())
            + "\",\"regCh\":\"" + regCh + "\",\"authCh\":\"" + authCh + "\",\"regCd\":\"" + BioCrypto.b64u(regCd.getBytes("UTF-8")) + "\",\"authCd\":\"" + BioCrypto.b64u(authCd.getBytes("UTF-8"))
            + "\",\"ad\":\"" + BioCrypto.b64u(ad) + "\",\"sig\":\"" + BioCrypto.b64u(sig) + "\"}");
    }
    static void check(boolean ok, String what) { if (!ok) { System.err.println("FAIL: " + what); System.exit(1); } System.err.println("  ok: " + what); }
}
