plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "mk.navigator"
    compileSdk = 34

    defaultConfig {
        applicationId = "mk.navigator"
        minSdk = 26 // ARCore needs 24; EncryptedFile and waveform vibration are comfortable at 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.2.0"
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
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webapp"))
}

// The UI and the navigation core are the same JavaScript that runs in the browser
// simulator: `npm run build` bundles it into one file that the app loads from assets.
val copyWebApp by tasks.registering(Copy::class) {
    from(rootProject.file("../dist/index.html"))
    into(layout.buildDirectory.dir("generated/webapp"))
}
// The printed marker and the copy ARCore tracks are the same file.
val copyMarker by tasks.registering(Copy::class) {
    from(rootProject.file("../marker/navigator-marker.png"))
    into(layout.buildDirectory.dir("generated/webapp"))
}
tasks.named("preBuild") { dependsOn(copyWebApp, copyMarker) }

dependencies {
    implementation("com.google.ar:core:1.44.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.security:security-crypto:1.0.0")
}
