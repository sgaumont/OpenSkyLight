package io.github.sgaumont.familyskyview.push;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Map;

/**
 * Shows one kiosk alert as an Android notification. The payload is fcmData() in
 * src/shared/pushAlerts.ts: key, kind, channel, title, body, tab, ring ("0"|"1"), actions (JSON).
 * Each alert is posted under tag = key, so a repeat of the same key replaces it instead of stacking.
 */
public final class PushNotifier {
    private PushNotifier() {}

    /** every notification uses this id; the tag (the alert key) tells them apart */
    static final int NOTIFICATION_ID = 1;
    /** intent extras MainActivity receives when a notification is tapped */
    public static final String EXTRA_TAB = "tab";
    public static final String EXTRA_KEY = "notificationKey";
    static final String REPLY_INPUT = "reply_text";

    /** one alert, as received (also re-posted from PushActionReceiver when a button fails) */
    static final class Alert {
        String key, kind, channel, title, body, tab, actions;
        boolean ring;

        static Alert from(Map<String, String> d) {
            Alert a = new Alert();
            a.key = nz(d.get("key"), "alert");
            a.kind = nz(d.get("kind"), "");
            a.channel = PushChannels.resolve(d.get("channel"));
            a.title = nz(d.get("title"), "Family Skyview");
            a.body = nz(d.get("body"), "");
            a.tab = nz(d.get("tab"), "");
            a.ring = !"0".equals(d.get("ring"));
            a.actions = d.get("actions");
            return a;
        }

        Bundle toBundle() {
            Bundle b = new Bundle();
            b.putString("key", key);
            b.putString("kind", kind);
            b.putString("channel", channel);
            b.putString("title", title);
            b.putString("body", body);
            b.putString("tab", tab);
            b.putBoolean("ring", ring);
            b.putString("actions", actions);
            return b;
        }

        static Alert fromBundle(Bundle b) {
            Alert a = new Alert();
            a.key = nz(b.getString("key"), "alert");
            a.kind = nz(b.getString("kind"), "");
            a.channel = PushChannels.resolve(b.getString("channel"));
            a.title = nz(b.getString("title"), "Family Skyview");
            a.body = nz(b.getString("body"), "");
            a.tab = nz(b.getString("tab"), "");
            a.ring = b.getBoolean("ring", true);
            a.actions = b.getString("actions");
            return a;
        }
    }

    public static void show(Context ctx, Map<String, String> data) {
        post(ctx, Alert.from(data), null);
    }

    /**
     * Posts the alert. `problem` (a failed button) adds a line saying what went wrong and never makes
     * a sound; the buttons stay so it can be tried again.
     */
    static void post(Context ctx, Alert a, String problem) {
        PushChannels.ensure(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return;

        String text = problem == null ? a.body : "⚠️ " + problem + (a.body.isEmpty() ? "" : "\n" + a.body);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, a.channel)
                .setSmallIcon(smallIcon(ctx))
                .setContentTitle(a.title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(openApp(ctx, a.key, a.tab))
                .setCategory(category(a.kind))
                // below Android 8 there are no channels: priority + silent stand in for them
                .setPriority(PushChannels.CHAT_QUIET.equals(a.channel) ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH);
        if (!a.ring || problem != null) b.setSilent(true);

        addActions(ctx, b, a);
        try {
            nm.notify(a.key, NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS was taken away between the check and the post
        }
    }

    /** replaces the alert with a short silent confirmation ("Approved ✓") that goes away on its own */
    static void confirm(Context ctx, Alert a, String text) {
        PushChannels.ensure(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, a.channel)
                .setSmallIcon(smallIcon(ctx))
                .setContentTitle(a.title)
                .setContentText(text)
                .setContentIntent(openApp(ctx, a.key, a.tab))
                .setAutoCancel(true)
                .setSilent(true)
                .setTimeoutAfter(4000);
        try {
            NotificationManagerCompat.from(ctx).notify(a.key, NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            // ignore: nothing to confirm on
        }
    }

    private static void addActions(Context ctx, NotificationCompat.Builder b, Alert a) {
        if (a.actions == null || a.actions.isEmpty()) return;
        JSONArray arr;
        try {
            arr = new JSONArray(a.actions);
        } catch (Exception e) {
            return;
        }
        // Android shows at most 3 buttons
        for (int i = 0; i < arr.length() && i < 3; i++) {
            JSONObject act = arr.optJSONObject(i);
            if (act == null) continue;
            String id = act.optString("id", "a" + i);
            String label = act.optString("label", id);
            String rpc = act.optString("rpc", "");
            if (rpc.isEmpty()) continue;
            JSONObject req = act.optJSONObject("req");
            boolean textInput = "text".equals(act.optString("input", ""));

            Intent intent = new Intent(ctx, PushActionReceiver.class)
                    .setAction(PushActionReceiver.ACTION)
                    .putExtra(PushActionReceiver.EXTRA_ALERT, a.toBundle())
                    .putExtra(PushActionReceiver.EXTRA_ACTION_ID, id)
                    .putExtra(PushActionReceiver.EXTRA_LABEL, label)
                    .putExtra(PushActionReceiver.EXTRA_RPC, rpc)
                    .putExtra(PushActionReceiver.EXTRA_REQ, req == null ? "{}" : req.toString())
                    .putExtra(PushActionReceiver.EXTRA_TEXT_INPUT, textInput);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            // an inline reply needs a mutable intent (Android fills in the typed text)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= textInput ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE;
            else if (!textInput && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, (a.key + "|" + id).hashCode(), intent, flags);

            NotificationCompat.Action.Builder ab = new NotificationCompat.Action.Builder(0, label, pi);
            if (textInput) {
                ab.addRemoteInput(new RemoteInput.Builder(REPLY_INPUT).setLabel(label).build())
                        .setAllowGeneratedReplies(false)
                        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY);
            }
            b.addAction(ab.build());
        }
    }

    /** tapping the notification opens the app on the alert's tab (MainActivity is singleTask) */
    static PendingIntent openApp(Context ctx, String key, String tab) {
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) launch = new Intent();
        launch.setPackage(ctx.getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_TAB, tab)
                .putExtra(EXTRA_KEY, key);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, key.hashCode(), launch, flags);
    }

    /**
     * A white-on-transparent status bar icon named ic_stat_family_skyview (res/drawable) when the app
     * has one; the launcher icon otherwise (shows as a white blob on most phones, but works).
     */
    private static int smallIcon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_family_skyview", "drawable", ctx.getPackageName());
        return id != 0 ? id : ctx.getApplicationInfo().icon;
    }

    private static String category(String kind) {
        switch (kind) {
            case "chat":
                return NotificationCompat.CATEGORY_MESSAGE;
            case "timers":
            case "leave":
                return NotificationCompat.CATEGORY_REMINDER;
            case "weather":
                return NotificationCompat.CATEGORY_STATUS;
            default:
                return NotificationCompat.CATEGORY_EVENT;
        }
    }

    private static String nz(String s, String fallback) {
        return s == null ? fallback : s;
    }
}
