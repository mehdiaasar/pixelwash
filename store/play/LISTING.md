# Google Play listing: Pixelwash

Everything to paste into Play Console, in the order the console asks for it. Graphics are in this folder.

| Asset | File | Play requirement |
|---|---|---|
| App icon | `icon-512.png` | 512×512 PNG |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500 PNG/JPG |
| Phone screenshots | `phone_1.png` … `phone_4.png` (1440×2880) | 2–8, aspect ≤ 2:1 |
| App bundle | `android/app/build/outputs/bundle/release/app-release.aab` (v1.0.2, versionCode 3) | .aab |

Regenerate the icon, launcher, splash and feature graphic with `python3 tools/make_icons.py`.

---

## 1. Create app

- **App name:** Pixelwash
- **Default language:** English (United States), en-US
- **App or game:** App
- **Free or paid:** Free
- Tick both declarations (Developer Program Policies, US export laws).

## 2. Main store listing

**App name** (30 max)
```
Pixelwash: Watermark & Upscale
```

**Short description** (80 max)
```
Remove watermarks and upscale videos right on your phone. Nothing is uploaded.
```

**Full description** (4000 max)
```
Pixelwash cleans up and sharpens your videos without uploading them anywhere. Every frame is processed on your phone, by your phone's own video chip and graphics processor. No account, no ads, no tracking, and it's free and open source.

TWO TOOLS

Watermark remover
• Finds static overlays for you, or drag a box around the mark yourself
• Measures how see-through a mark is across the whole video and reverses it, so the real picture underneath comes back instead of a blur
• Solid logos are filled in from their surroundings
• Before/after slider and a "leftover" score so you can check the result
• Remember a mark and it's found again in your next video

Upscaler
• Upscale to 1080p, vertical 4K, 16:9 4K, 2× or keep the size and just enhance
• Classical mode: Lanczos resize plus contrast-adaptive sharpening, fast and faithful
• AI blend: the Real-ESRGAN anime-video model mixed with the classical result, for crisper eyes and outlines on cartoons and animation while 3D shading stays natural
• Preview a single frame before you process the whole video

PRIVATE BY DESIGN
• Your videos never leave your device
• No sign-in, no analytics, no ads
• Results go straight to your gallery (Movies/Pixelwash), or share them to any app
• Works offline: the AI model and fonts are built in

GOOD TO KNOW
• Keeps the original frame rate and audio; saves H.264 MP4
• AI blend is demanding: expect a few seconds per frame on a recent phone
• Needs Android 10 or newer with an up-to-date Android System WebView

Please only remove marks from videos you own or have the rights to edit. If a platform asks you to label AI-generated or altered content, keep that label on when you upload.

Pixelwash is open source (MIT): github.com/mehdiaasar/pixelwash
```

**Graphics:** icon, feature graphic and the four phone screenshots from this folder. Tablet screenshots are optional; skip them.

## 3. Store settings

- **Category:** Video Players & Editors
- **Tags** (pick up to 5 that Play offers): Video editor, Photo & video tools, Video enhancer
- **Contact email:** your choice (Play shows it publicly)
- **Website:** https://mehdiaasar.github.io/pixelwash/

## 4. App content (Policy → App content)

| Form | Answer |
|---|---|
| Privacy policy | https://mehdiaasar.github.io/pixelwash/privacy.html |
| Ads | No, the app does not contain ads |
| App access | All functionality is available without special access |
| Content rating | Start questionnaire → category **All other app types** → answer **No** to every question (no violence, sexuality, language, drugs, gambling; no user interaction or content sharing *inside* the app; no location sharing; no digital purchases). Expected: Everyone / PEGI 3 / IARC 3+ |
| Target audience | 13–15, 16–17 and 18+ (not under 13, so the Families policy doesn't apply). "Could the store listing appeal to children?" → No |
| News app | No |
| Data safety | "Does your app collect or share any of the required user data types?" → **No**. That ends the form. Summary shown on Play: *No data collected · No data shared* |
| Advertising ID | No, the app does not use advertising ID |
| Government app | No |
| Financial features | My app doesn't provide any financial features |
| Health | My app does not have any health features |

## 5. Release

- **Play App Signing:** Play's default keeps a Google-held app signing key and turns `~/claude/pixelwash-keys/pixelwash-release.keystore` into your *upload* key. Consequence: the GitHub APK (signed with your key) and the Play install (signed by Google) can't update each other; a user switching between them must uninstall first. To keep them interchangeable, choose "Use a different key → Export and upload a key from Java keystore" and follow Play's PEPK steps with the existing keystore (alias in `keystore.properties`).
- **Testing first:** a *personal* developer account created after 13 Nov 2023 must run a **closed test with at least 12 testers opted in for 14 days in a row** before Play unlocks production. Organisation accounts skip this. Start with Testing → Closed testing → upload the .aab, add testers by email list, share the opt-in link.
- **Release name:** 1.0.2
- **Release notes:**
```
<en-US>
First Play release. Remove watermarks and upscale videos entirely on your phone: no uploads, no account, no ads. Results save straight to your gallery.
</en-US>
```

## Policy note

Watermark-removal apps are allowed on Play, but reviewers look for apps that encourage removing other people's marks. The listing and the app both say to use it only on videos you own or have rights to; don't add screenshots or wording that show a third-party brand or platform logo being removed.
