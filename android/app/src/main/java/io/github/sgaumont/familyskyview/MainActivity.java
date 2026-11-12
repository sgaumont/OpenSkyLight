package io.github.sgaumont.familyskyview;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import io.github.sgaumont.familyskyview.push.FamilySkyviewPushPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // app-local Capacitor plugins must be registered before the bridge starts
        registerPlugin(FamilySkyviewPushPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
