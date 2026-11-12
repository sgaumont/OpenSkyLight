package io.github.sgaumont.familyskyview.push;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A notification button was pressed (Approve, OK, No, or a typed Reply): POST the action's rpc to the
 * kiosk with its req, then swap the notification for a short "✓" or, on failure, put it back with
 * what went wrong so it can be tried again or opened.
 */
public class PushActionReceiver extends BroadcastReceiver {
    static final String ACTION = "io.github.sgaumont.familyskyview.PUSH_ACTION";
    static final String EXTRA_ALERT = "alert";
    static final String EXTRA_ACTION_ID = "actionId";
    static final String EXTRA_LABEL = "label";
    static final String EXTRA_RPC = "rpc";
    static final String EXTRA_REQ = "req";
    static final String EXTRA_TEXT_INPUT = "textInput";

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;
        Bundle alertBundle = intent.getBundleExtra(EXTRA_ALERT);
        String rpc = intent.getStringExtra(EXTRA_RPC);
        if (alertBundle == null || rpc == null) return;
        final PushNotifier.Alert alert = PushNotifier.Alert.fromBundle(alertBundle);
        final String label = intent.getStringExtra(EXTRA_LABEL);
        final boolean textInput = intent.getBooleanExtra(EXTRA_TEXT_INPUT, false);
        final String reqJson = intent.getStringExtra(EXTRA_REQ);

        String typed = null;
        if (textInput) {
            Bundle input = RemoteInput.getResultsFromIntent(intent);
            CharSequence cs = input == null ? null : input.getCharSequence(PushNotifier.REPLY_INPUT);
            typed = cs == null ? "" : cs.toString().trim();
            if (typed.isEmpty()) {
                // nothing typed: put the notification back as it was (stops the reply spinner)
                PushNotifier.post(context, alert, null);
                return;
            }
        }

        final Context app = context.getApplicationContext();
        final String text = typed;
        final PendingResult pending = goAsync();
        IO.execute(() -> {
            try {
                JSONObject req;
                try {
                    req = new JSONObject(reqJson == null ? "{}" : reqJson);
                } catch (Exception e) {
                    req = new JSONObject();
                }
                if (text != null) fillReply(app, req, text);
                KioskClient.Result r = KioskClient.rpc(app, rpc, req);
                if (r.ok) PushNotifier.confirm(app, alert, text != null ? "Sent ✓" : (label == null ? "Done" : label) + " ✓");
                else PushNotifier.post(app, alert, r.error);
            } catch (Exception e) {
                PushNotifier.post(app, alert, "Something went wrong");
            } finally {
                pending.finish();
            }
        });
    }

    /**
     * The chat Reply button's req ({} from the kiosk) gets what NotesPage sends: the text, this phone's
     * name, its push endpoint (so it isn't told about its own message) and ring=false (🔕 Quiet, the
     * same default as the app's send box). authorId only when the web UI mirrored one.
     */
    private static void fillReply(Context ctx, JSONObject req, String text) throws Exception {
        if (text.length() > 280) text = text.substring(0, 280);
        req.put("text", text);
        if (!req.has("ring")) req.put("ring", false);
        String name = KioskClient.phoneName(ctx);
        if (name != null) req.put("deviceName", name.length() > 40 ? name.substring(0, 40) : name);
        String author = KioskClient.authorId(ctx);
        if (author != null && !req.has("authorId")) req.put("authorId", author);
        String token = PushTokens.current(ctx);
        if (token != null) req.put("endpoint", PushTokens.endpoint(token));
    }
}
