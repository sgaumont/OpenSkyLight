package io.github.sgaumont.familyskyview.update;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Updates Family Skyview from the tablet (registerPlugin('FamilySkyviewUpdate') in JS). The tablet
 * hands out the APK it was built with at GET /app/family-skyview.apk; the web UI compares versions
 * (GET /api/app-info) and calls install() when the tablet's is newer.
 *
 * Methods:
 *   getVersion() → { version, code }
 *   install({ path }) → { started: true } once Android's "Update this app?" prompt is up, or
 *                       { needsPermission: true } after opening the "Install unknown apps" setting
 *                       (first time only; tap Update again after allowing it)
 * Events: 'downloadProgress' { percent }
 */
@CapacitorPlugin(name = "FamilySkyviewUpdate")
public class FamilySkyviewUpdatePlugin extends Plugin {
    private static final String CAP_PREFS = "CapacitorStorage";
    private static final String KEY_BASES = "osl.kioskBases";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            JSObject o = new JSObject();
            o.put("version", info.versionName);
            o.put("code", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
            call.resolve(o);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Couldn't read the app version");
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "/app/family-skyview.apk");
        Context ctx = getContext();
        // Android 8+: the app needs the user's OK once to install apps ("Install unknown apps")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(settings);
            JSObject o = new JSObject();
            o.put("needsPermission", true);
            call.resolve(o);
            return;
        }
        IO.execute(() -> {
            try {
                File apk = download(ctx, path);
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent view = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(view);
                JSObject o = new JSObject();
                o.put("started", true);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Couldn't download the update" : e.getMessage());
            }
        });
    }

    /** Fetches the APK from the first saved tablet address that answers (home Wi-Fi before Tailscale). */
    private File download(Context ctx, String path) throws IOException {
        File dir = new File(ctx.getCacheDir(), "update");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("No room for the update");
        File out = new File(dir, "Family-Skyview.apk");
        IOException last = new IOException("Couldn't reach the tablet");
        for (String base : bases(ctx)) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + path).openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(20000);
                int status = c.getResponseCode();
                if (status == 404) throw new IOException("The tablet doesn't have the app to hand out");
                if (status != 200) throw new IOException("The tablet answered " + status);
                long total = c.getContentLengthLong();
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int lastPercent = -1;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        os.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int percent = (int) (done * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                JSObject p = new JSObject();
                                p.put("percent", percent);
                                notifyListeners("downloadProgress", p);
                            }
                        }
                    }
                    if (total > 0 && done != total) throw new IOException("The download was cut short");
                }
                return out;
            } catch (IOException e) {
                last = e;
                // the tablet answered with a real problem: don't try the other addresses
                if (e.getMessage() != null && e.getMessage().startsWith("The tablet")) throw e;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        throw last;
    }

    private static List<String> bases(Context ctx) {
        List<String> out = new ArrayList<>();
        String raw = ctx.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).getString(KEY_BASES, null);
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                String b = arr.optString(i, "").trim();
                while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
                if (!b.isEmpty()) out.add(b);
            }
        } catch (Exception ignored) {
            // not paired
        }
        return out;
    }
}
