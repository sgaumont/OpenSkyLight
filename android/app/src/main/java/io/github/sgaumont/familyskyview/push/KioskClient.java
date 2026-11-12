package io.github.sgaumont.familyskyview.push;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Calls the kiosk from native code (notification buttons), using the pairing the web UI mirrors into
 * @capacitor/preferences (SharedPreferences "CapacitorStorage"):
 *   osl.companionToken = bearer token, osl.kioskBases = JSON array of base URLs in preference order,
 *   osl.phoneName = this phone's name (optional), osl.authorId = remembered family member (optional).
 * Blocking: call it off the main thread.
 */
public final class KioskClient {
    private KioskClient() {}

    static final String CAP_PREFS = "CapacitorStorage";
    static final String KEY_TOKEN = "osl.companionToken";
    static final String KEY_BASES = "osl.kioskBases";
    static final String KEY_PHONE_NAME = "osl.phoneName";
    static final String KEY_AUTHOR = "osl.authorId";

    /** short, so two unreachable bases still fit inside a broadcast receiver's time */
    private static final int CONNECT_MS = 2500;
    private static final int READ_MS = 4000;

    public static final class Result {
        public final boolean ok;
        /** what to tell the user when !ok */
        public final String error;
        public final Object data;

        private Result(boolean ok, String error, Object data) {
            this.ok = ok;
            this.error = error;
            this.data = data;
        }

        static Result ok(Object data) { return new Result(true, null, data); }
        static Result fail(String error) { return new Result(false, error, null); }
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
    }

    static String phoneName(Context ctx) {
        String s = prefs(ctx).getString(KEY_PHONE_NAME, null);
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }

    static String authorId(Context ctx) {
        String s = prefs(ctx).getString(KEY_AUTHOR, null);
        return s == null || s.isEmpty() ? null : s;
    }

    static List<String> bases(Context ctx) {
        List<String> out = new ArrayList<>();
        String raw = prefs(ctx).getString(KEY_BASES, null);
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                String b = arr.optString(i, "").trim();
                while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
                if (!b.isEmpty()) out.add(b);
            }
        } catch (Exception ignored) {
            // not JSON: treat as no pairing
        }
        return out;
    }

    /** POST <base>/api/rpc/<rpc> with the token, trying each base in order until one answers. */
    public static Result rpc(Context ctx, String rpc, JSONObject req) {
        String token = prefs(ctx).getString(KEY_TOKEN, null);
        List<String> bases = bases(ctx);
        if (token == null || token.isEmpty() || bases.isEmpty()) return Result.fail("This phone isn't paired with the tablet");
        byte[] body = req.toString().getBytes(StandardCharsets.UTF_8);
        String lastError = "Couldn't reach the tablet";
        for (String base : bases) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + "/api/rpc/" + rpc).openConnection();
                c.setConnectTimeout(CONNECT_MS);
                c.setReadTimeout(READ_MS);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body);
                }
                int status = c.getResponseCode();
                // the kiosk answered: don't try the next base, its answer is the answer
                if (status == 401 || status == 403) return Result.fail("This phone isn't paired with the tablet any more");
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                String text = in == null ? "" : readAll(in);
                JSONObject res;
                try {
                    res = new JSONObject(text);
                } catch (Exception e) {
                    return Result.fail("The tablet sent an odd answer (" + status + ")");
                }
                if (res.optBoolean("ok", false)) return Result.ok(res.opt("data"));
                return Result.fail(errorText(res.opt("error"), status));
            } catch (IOException e) {
                lastError = "Couldn't reach the tablet";
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return Result.fail(lastError);
    }

    private static String errorText(Object error, int status) {
        if (error instanceof String && !((String) error).isEmpty()) return (String) error;
        if (error instanceof JSONObject) {
            String m = ((JSONObject) error).optString("message", "");
            if (!m.isEmpty()) return m;
        }
        return "The tablet said no (" + status + ")";
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
