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

        // The Picovoice key comes from a GitHub Secret (PICOVOICE_ACCESS_KEY). It is never written in the code.
        buildConfigField("String", "PICOVOICE_KEY", "\"${System.getenv("PICOVOICE_ACCESS_KEY") ?: ""}\"")
    }

    buildFeatures {
        buildConfig = true
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
    // Offline "Hey SONIC" wake-word engine (check the latest version on Maven Central before building)
    implementation("ai.picovoice:porcupine-android:3.0.2")
}
