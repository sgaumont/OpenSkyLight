package io.github.sgaumont.familyskyview.push;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives the kiosk's FCM messages. They are data-only (no "notification" block), so this runs
 * whether the app is open, in the background or closed, and we build the notification ourselves.
 */
public class FamilySkyviewMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data.isEmpty() || !data.containsKey("title")) return;
        PushNotifier.show(this, data);
    }

    /** Firebase rotated this phone's token: remember it and tell the web UI so it re-subscribes. */
    @Override
    public void onNewToken(@NonNull String token) {
        PushTokens.remember(this, token);
        FamilySkyviewPushPlugin.emitToken(token);
    }
}
