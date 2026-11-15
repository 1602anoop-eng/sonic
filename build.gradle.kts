plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sonic.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.sonic.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    // Vosk offline speech engine (check the latest version on Maven Central before building)
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    // Vosk needs JNA to work on Android
    implementation("net.java.dev.jna:jna:5.14.0@aar")
}
