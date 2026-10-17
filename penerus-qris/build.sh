#!/usr/bin/env bash
# Merakit Penerus QRIS tanpa Gradle (Git Bash di Windows): javac -> d8 -> aapt2 -> zipalign -> apksigner.
# Alat: JDK 17 + Android SDK (platforms;android-35, build-tools;35.0.0) di $PENERUS_TOOLCHAIN
# (bawaan %LOCALAPPDATA%\penerus-toolchain). Kunci tanda tangan TIDAK di repo: $PENERUS_TOOLCHAIN/kunci/.
# Kunci yang sama wajib dipakai untuk setiap pembaruan -- kalau hilang, aplikasi harus dicopot dulu.
set -euo pipefail
cd "$(dirname "$0")"
T="${PENERUS_TOOLCHAIN:-$LOCALAPPDATA/penerus-toolchain}"
JH="$(ls -d "$T"/jdk/jdk-17* | head -1)"
export JAVA_HOME="$JH" PATH="$JH/bin:$PATH"
SDK="$T/sdk"; BT="$SDK/build-tools/35.0.0"; JAR="$SDK/platforms/android-35/android.jar"
OUT=build; rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex"

# --release 8: pustaka dasar Java dari JDK (lambda butuh LambdaMetafactory), kelas Android dari android.jar.
javac -encoding UTF-8 --release 8 -Xlint:-options -classpath "$JAR" \
  -d "$OUT/classes" $(find src -name '*.java')
"$BT/d8.bat" --min-api 24 --release --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
"$BT/aapt2.exe" link -o "$OUT/base.apk" --manifest AndroidManifest.xml -I "$JAR" \
  --min-sdk-version 24 --target-sdk-version 35
python -I - "$OUT/base.apk" "$OUT/dex/classes.dex" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[2], 'classes.dex')
PY
"$BT/zipalign.exe" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

KS="$T/kunci/penerus-qris.jks"
if [ ! -f "$KS" ]; then
  mkdir -p "$T/kunci"
  PASS="$(python -I -c 'import secrets; print(secrets.token_hex(16))')"
  printf '%s' "$PASS" > "$T/kunci/sandi.txt"
  keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias penerus \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Penerus QRIS, O=OwnerTenang, C=ID" >/dev/null
fi
PASS="$(cat "$T/kunci/sandi.txt")"
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass "pass:$PASS" --key-pass "pass:$PASS" --ks-key-alias penerus \
  --out "$OUT/PenerusQRIS.apk" "$OUT/aligned.apk"
"$BT/apksigner.bat" verify "$OUT/PenerusQRIS.apk"
echo "APK: $(pwd)/$OUT/PenerusQRIS.apk"
