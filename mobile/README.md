# Kapu for Android and iOS

These are the native apps for the Play Store and the App Store, built with [Capacitor](https://capacitorjs.com).
The app opens the live Kapu site, so every change you publish on the website reaches app users at once,
with no store update. Logins, M-Pesa, chats, notifications and maps all work the same as on the website.

| Folder | What it is |
|---|---|
| `android/` | Android Studio project (Play Store) |
| `ios/` | Xcode project (App Store), opened on a Mac |
| `assets/` | The 1024 px icon and splash screens the store icons were made from |
| `capacitor.config.json` | App name, app id (`com.ordersasa.app`) and the site address the app opens |

## Before publishing: use your own domain

The app opens the address in `capacitor.config.json` → `server.url` (now the ngrok test address).
Before you publish, buy a domain (e.g. `kapu.co.ke`), point it at your server, then change **both**
`server.url` and `server.allowNavigation` to it and run:

```
cd mobile
npx cap sync
```

The free ngrok address shows a "you are about to visit" warning page and can change, so it isn't suitable for the stores.

## Android (Play Store): on any Windows, Mac or Linux computer

1. Install **Android Studio** (it brings Java and the Android SDK).
2. `cd mobile` then `npx cap open android` (or open the `mobile/android` folder in Android Studio).
3. Try it: pick a phone or emulator and press ▶ Run.
4. Release: **Build → Generate Signed App Bundle** → create a key (keep the key file and passwords safe, you need
   them for every update) → you get `app-release.aab`.
5. Upload the `.aab` in the [Google Play Console](https://play.google.com/console) (one-time USD 25 developer fee).

## iOS (App Store): needs a Mac

1. On a Mac, install **Xcode** and CocoaPods (`sudo gem install cocoapods`).
2. Copy the project, then `cd mobile && npm install && npx cap sync ios && npx cap open ios`.
3. In Xcode: select the *App* target → *Signing & Capabilities* → choose your Apple Developer team.
4. Try it on an iPhone (▶ Run), then **Product → Archive → Distribute App → App Store Connect**.
5. Finish the listing in [App Store Connect](https://appstoreconnect.apple.com) (Apple Developer Program: USD 99 a year).

## Without the stores (works today)

The website itself is an installable app (a Progressive Web App):

- **Android / Chrome / Edge:** tap **📲 Get the Kapu app** at the bottom of any page (or in the menu).
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

## After changing the icon or splash screen

Replace the files in `assets/`, then:

```
cd mobile
npx capacitor-assets generate --iconBackgroundColor "#ff5a1f" --splashBackgroundColor "#faf8f5" --splashBackgroundColorDark "#14171f"
npx cap sync
```
