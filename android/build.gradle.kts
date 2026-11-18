plugins {
    id("com.android.application") version "9.3.1" apply false
    // AGP 9 compiles Kotlin itself; this only puts KGP on the classpath (as in Grabber).
    id("org.jetbrains.kotlin.android") version "2.4.10" apply false
}
