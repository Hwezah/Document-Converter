plugins {
    id("com.android.application")
}

android {
    namespace = "com.hwezah.folio"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.hwezah.folio"
        minSdk = 29
        targetSdk = 36
        // Each CI build is newer than the last (100 + GitHub's run number), so it installs as an update.
        val build = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull()
        versionCode = if (build != null) 100 + build else 1
        versionName = if (build != null) "1.0.0 (build $build)" else "1.0.0"
    }

    // A committed debug key (not a secret): every CI build installs over the last, keeping your documents.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            isDebuggable = false
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The built web app (npm run build) is copied into assets/www by CI.
    androidResources { noCompress += listOf("woff2", "mjs") }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
