@echo off
rem Builds the test APK (Android) and copies it to AlingNenaShop-test.apk.
rem Uses the Java that comes with Android Studio (Gradle needs Java 17 or newer).
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
call npx cap sync android || exit /b 1
pushd android
call .\gradlew.bat assembleDebug || (popd & exit /b 1)
popd
copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "AlingNenaShop-test.apk" >nul
echo.
echo Done: %CD%\AlingNenaShop-test.apk
