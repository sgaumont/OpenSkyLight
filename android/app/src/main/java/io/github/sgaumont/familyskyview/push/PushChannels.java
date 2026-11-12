package io.github.sgaumont.familyskyview.push;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * The Android notification channels, one per PushChannel in src/shared/pushAlerts.ts. Each shows up
 * in the phone's Settings → Notifications for Family Skyview, so the family can mute or change the
 * sound of one kind without losing the others. Creating a channel that exists is a no-op, so this is
 * safe to call every time.
 */
public final class PushChannels {
    private PushChannels() {}

    public static final String CHAT_RING = "chat_ring";
    public static final String CHAT_QUIET = "chat_quiet";
    public static final String APPROVALS = "approvals";
    public static final String SHOP = "shop";
    public static final String TIMERS = "timers";
    public static final String LEAVE = "leave";
    public static final String WEATHER = "weather";
    /** anything the kiosk sends that this app version doesn't know yet */
    public static final String OTHER = "other";

    public static void ensure(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        int high = NotificationManager.IMPORTANCE_HIGH;
        create(nm, CHAT_RING, "Chat messages", "Messages sent with 🔔 Ring, and everything from the tablet", high);
        create(nm, CHAT_QUIET, "Quiet chat messages", "Messages sent 🔕 Quiet: shown without a sound", NotificationManager.IMPORTANCE_LOW);
        create(nm, APPROVALS, "Chores to approve", "A kid finished something that needs a parent's OK", high);
        create(nm, SHOP, "Shop requests", "A kid wants to buy something from the Shop", high);
        create(nm, TIMERS, "Timers", "A kid's timer is up", high);
        create(nm, LEAVE, "Time to leave", "Time to leave for an event", high);
        create(nm, WEATHER, "Weather warnings", "Weather warnings and watches", high);
        create(nm, OTHER, "Other", "Anything else from the tablet", NotificationManager.IMPORTANCE_DEFAULT);
    }

    /** the channel to post on: the kiosk's, or OTHER when this app doesn't know it */
    public static String resolve(String channel) {
        if (channel == null) return OTHER;
        switch (channel) {
            case CHAT_RING:
            case CHAT_QUIET:
            case APPROVALS:
            case SHOP:
            case TIMERS:
            case LEAVE:
            case WEATHER:
                return channel;
            default:
                return OTHER;
        }
    }

    private static void create(NotificationManager nm, String id, String name, String description, int importance) {
        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(description);
        nm.createNotificationChannel(ch);
    }
}
