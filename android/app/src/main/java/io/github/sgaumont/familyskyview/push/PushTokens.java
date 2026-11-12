package io.github.sgaumont.familyskyview.push;

import android.content.Context;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.concurrent.TimeUnit;

/**
 * This phone's FCM token, remembered in our own SharedPreferences ("FamilySkyviewPush") so native
 * code can name itself to the kiosk without asking Firebase every time. The kiosk stores an Android
 * phone as the push endpoint "fcm:<token>" (v0.8.168, notify:subscribeFcm).
 */
final class PushTokens {
    private PushTokens() {}

    private static final String PREFS = "FamilySkyviewPush";
    private static final String KEY_TOKEN = "fcmToken";

    static String endpoint(String token) {
        return "fcm:" + token;
    }

    static void remember(Context ctx, String token) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_TOKEN, token).apply();
    }

    static void forget(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_TOKEN).apply();
    }

    /** the remembered token, or (off the main thread only) a quick ask of Firebase; null if neither works */
    static String current(Context ctx) {
        String t = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null);
        if (t != null && !t.isEmpty()) return t;
        try {
            t = Tasks.await(FirebaseMessaging.getInstance().getToken(), 3, TimeUnit.SECONDS);
            if (t != null && !t.isEmpty()) remember(ctx, t);
            return t;
        } catch (Exception e) {
            // no google-services.json (Firebase not set up), no network, or called on the main thread
            return null;
        }
    }
}
