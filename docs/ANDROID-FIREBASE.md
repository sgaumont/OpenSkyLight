# Firebase setup for the Android app's notifications

The Android app, **Family Skyview**, gets its notifications through Google's Firebase Cloud
Messaging. This is set up once and costs nothing (Firebase's free plan, no billing account).
It takes about 15 minutes.

You end up with two files:

| File | What it's for | Where it goes |
|---|---|---|
| `google-services.json` | Tells the Android app which Firebase project it belongs to | `C:\Development\OpenSkyLight\android\app\google-services.json`, on this PC, for building the app |
| `fcm-service-account.json` | Lets the tablet send notifications | `%APPDATA%\OpenSkyLight\fcm-service-account.json`, on the **tablet** |

Neither file goes in the GitHub repo. Both are in `.gitignore`. Treat the second one like a
password: anyone who has it can send notifications to your phones.

Phones that use the browser version of the companion app don't need any of this. Their
notifications keep working as they do now.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** and name it `Family Skyview`.
3. Gemini and Google Analytics are optional. Notifications don't need either, and leaving them on does no harm.
4. Wait for the project to be created, then click **Continue**.

## 2. Register the Android app

1. On the project's home page, click the **Android** icon ("Add app").
2. **Android package name:** `io.github.sgaumont.familyskyview`, typed exactly. This must
   match the app, or notifications never arrive.
3. **App nickname:** `Family Skyview`. Leave **SHA-1** empty; notifications don't need it.
4. Click **Register app**, then **Download google-services.json**.
5. Move that file to `C:\Development\OpenSkyLight\android\app\google-services.json`.
6. Skip the "Add Firebase SDK" steps that follow. The app is already set up for them.

## 3. Check that Cloud Messaging is on

1. Click the ⚙️ gear next to **Project Overview**, then **Project settings**, then the
   **Cloud Messaging** tab.
2. **Firebase Cloud Messaging API (V1)** should say **Enabled**. If it doesn't, use its ⋮ menu
   to open it in Google Cloud and click **Enable**.

## 4. Make a key that can only send notifications

The Firebase console's own **Service accounts → Generate new private key** button also works.
But that key can manage the whole Firebase project, so make a narrower one:

1. Go to <https://console.cloud.google.com>. In the project picker at the top, choose
   **Family Skyview**. It's the same project.
2. Go to **IAM & Admin → Service Accounts → + Create service account**.
3. **Name:** `fcm-sender`. Click **Create and continue**.
4. **Role:** search for and pick **Firebase Cloud Messaging API Admin**. Click **Continue**,
   then **Done**.
5. Click the new `fcm-sender` account, open the **Keys** tab, then **Add key → Create new key →
   JSON → Create**. A `.json` file downloads.

If step 5 says key creation is disabled by an organization policy, the project belongs to a
Google Workspace organization. A project made under a personal Gmail account doesn't have this
restriction.

## 5. Put the key on the tablet

1. Rename the downloaded file to `fcm-service-account.json`.
2. On the tablet, open File Explorer, type `%APPDATA%\OpenSkyLight` in the address bar and press
   Enter. That folder already holds `openskylight.db`.
3. Copy the file there. No restart is needed: the tablet checks for the key each time it sends.
4. Delete the copy in your Downloads folder. If you want a spare, keep it in a password manager,
   not in email or cloud storage.

## 6. Check it works

1. On the tablet, go to **Settings → General → Companion app → Phone notifications**.
2. **Android app (Family Skyview)** should say **✅ ready** and name your Firebase project.
3. Once Family Skyview is installed on a phone and its notifications are on, the phone appears
   in the list with 🤖. Press **Test**. "🔔 Test sent" means the setup works.

| What you see | What to do |
|---|---|
| **not set up yet** | The file isn't in the right folder, or isn't named `fcm-service-account.json`. |
| **the key file can't be used** | The file isn't the JSON key from step 4. Download a new key. |
| **Couldn't reach that phone** | Check that the tablet is online. If the phone's app was reinstalled, turn its notifications off and on again. |

## If the key ever leaks

In Google Cloud, go to **IAM & Admin → Service Accounts → fcm-sender → Keys** and delete the
key. Then make a new one (step 4, item 5) and put it on the tablet (step 5). The phones don't
need to change anything.
