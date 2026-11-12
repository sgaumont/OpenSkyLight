package io.github.sgaumont.familyskyview.push;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

import java.lang.ref.WeakReference;

/**
 * The web UI's bridge to native notifications (registerPlugin('FamilySkyviewPush') in JS).
 *
 * Methods:
 *   checkPermissions() / requestPermissions() → { notifications: 'granted'|'denied'|'prompt' }
 *   getToken()    → { token, endpoint }   endpoint = "fcm:<token>", what notify:subscribeFcm stores
 *   deleteToken() → {}                    on unpair: this phone stops getting pushes
 * Events (addListener):
 *   'tokenRefresh' { token, endpoint }    Firebase rotated the token: call notify:subscribeFcm again
 *   'openTab'      { tab, key }           a notification was tapped; kept until a listener takes it,
 *                                          so a cold start (app opened by the tap) still gets it
 */
@CapacitorPlugin(
        name = "FamilySkyviewPush",
        permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = FamilySkyviewPushPlugin.NOTIFICATIONS)
)
public class FamilySkyviewPushPlugin extends Plugin {
    static final String NOTIFICATIONS = "notifications";

    /** the live plugin, so FamilySkyviewMessagingService can pass on a new token */
    private static WeakReference<FamilySkyviewPushPlugin> live = new WeakReference<>(null);

    @Override
    public void load() {
        live = new WeakReference<>(this);
        PushChannels.ensure(getContext());
        if (getActivity() != null) takeTab(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        takeTab(intent);
    }

    @Override
    protected void handleOnDestroy() {
        if (live.get() == this) live.clear();
        super.handleOnDestroy();
    }

    static void emitToken(String token) {
        FamilySkyviewPushPlugin p = live.get();
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("token", token);
        o.put("endpoint", PushTokens.endpoint(token));
        p.notifyListeners("tokenRefresh", o);
    }

    private void takeTab(Intent intent) {
        if (intent == null) return;
        String tab = intent.getStringExtra(PushNotifier.EXTRA_TAB);
        if (tab == null) return;
        String key = intent.getStringExtra(PushNotifier.EXTRA_KEY);
        // once only: a later recreate of the activity mustn't jump tabs again
        intent.removeExtra(PushNotifier.EXTRA_TAB);
        intent.removeExtra(PushNotifier.EXTRA_KEY);
        JSObject o = new JSObject();
        o.put("tab", tab);
        o.put("key", key);
        notifyListeners("openTab", o, true);
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging fm;
        try {
            fm = FirebaseMessaging.getInstance();
        } catch (IllegalStateException e) {
            call.reject("Firebase isn't set up in this build (google-services.json is missing)", "NO_FIREBASE");
            return;
        }
        fm.getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                Exception e = task.getException();
                call.reject("Couldn't get a push token" + (e != null && e.getMessage() != null ? ": " + e.getMessage() : ""), "NO_TOKEN");
                return;
            }
            String token = task.getResult();
            PushTokens.remember(getContext(), token);
            JSObject o = new JSObject();
            o.put("token", token);
            o.put("endpoint", PushTokens.endpoint(token));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void deleteToken(PluginCall call) {
        PushTokens.forget(getContext());
        FirebaseMessaging fm;
        try {
            fm = FirebaseMessaging.getInstance();
        } catch (IllegalStateException e) {
            call.resolve();
            return;
        }
        fm.deleteToken().addOnCompleteListener(task -> call.resolve());
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveLegacy(call);
            return;
        }
        super.checkPermissions(call);
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        // before Android 13 there's nothing to ask: notifications are on unless turned off in Settings
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            checkPermissions(call);
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "permissionAnswered");
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        checkPermissions(call);
    }

    private void resolveLegacy(PluginCall call) {
        JSObject o = new JSObject();
        o.put(NOTIFICATIONS, NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied");
        call.resolve(o);
    }
}
