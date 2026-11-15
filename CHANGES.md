# SONIC – kya badla (Step 1 + Step 2)

STATUS: code likha gaya hai, lekin abhi tak BUILD NAHI hua aur PHONE par TEST NAHI hua.
Pehla asli build GitHub Actions par hoga.

## Jagah ki galti (sabse badi problem)
- Wake word wali files root folder mein padi thi, isliye APK mein aati hi nahi thi.
- Ab sab `android/app/src/main/java/com/sonic/app/` mein hain. Purani root copies `_old_root_files/` mein safe hain.

## Android (Kotlin)
- VoiceService: model download safe (adhoora download hata deta hai, 10 min baad dobara try), "hey sonic" turant,
  akela "sonic" sirf final result par, 5 sec cooldown, notification mein "Band karo" button,
  fallback engine har miss par dheere hota hai (battery + beep kam), Android 14 full-screen check.
- JarvisBridge: lambi awaaz tukdon mein, purani awaaz ka galat "done" signal band, voice profiles
  (female/male, gehri, patli - pitch se bhi), voice interruption (barge-in) loudness se, silence settings, destroy().
- MainActivity: camera/mic permission alag alag check, sirf https site, bridge band hota hai, "Band karo" web ko batata hai.
- PhoneControl: Settings kholne ka bug fix (Android 11+), battery / notification / full-screen settings pages.
- Manifest: app icon, allowBackup off. build.gradle: Vosk + JNA.

## Web (index.html)
- Naye profiles, barge-in toggle app se judha, wake help buttons (sirf app ke andar dikhte hain).

## Android ki seemayein (sach)
- Background mic hamesha-on nahi: notification zaroori hai. Android 14+ par service sirf app khulne par shuru ho sakti hai
  aur phone restart ke baad apne aap shuru nahi hogi. Pehle app kholo, setting on karo.
- Wake word English "Hey SONIC" hai. Uske baad ki baat Hindi/English/Hinglish chal sakti hai.
