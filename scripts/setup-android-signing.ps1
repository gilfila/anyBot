# One-time setup: creates the Android upload key for the Any Bot phone app and
# stores it as GitHub Actions secrets, so every release can attach a signed
# AnyBot-phone.apk (docs/mobile.md). Run it once, on your own PC:
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-android-signing.ps1
#
# The key and its password are generated here and go straight to GitHub; the
# password is never printed. Back up the folder it names: every future app
# update must be signed with this same key, or phones would have to uninstall
# and reinstall the app.
$ErrorActionPreference = "Stop"
$repo = "gilfila/anyBot"
$folder = Join-Path $env:USERPROFILE ".anybot-signing"
$keystore = Join-Path $folder "anybot-release.jks"
$passwordFile = Join-Path $folder "anybot-release.password.txt"

if (Test-Path $keystore) {
  throw "An upload key already exists at $keystore. Using a new one would break updates for installed phones. If you really mean to replace it, move that folder away first."
}

$keytool = @(
  $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin\keytool.exe" }),
  "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe",
  "C:\Program Files\Android\Android Studio\jre\bin\keytool.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) { throw "keytool not found. Install Android Studio, or set JAVA_HOME to a JDK." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "The GitHub CLI (gh) isn't installed." }
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Sign in to the GitHub CLI first: gh auth login" }

New-Item -ItemType Directory -Force $folder | Out-Null
# A long random password, handed to keytool through the environment only.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:ANYBOT_KS_PASS = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "A").Replace("/", "B")
try {
  & $keytool -genkeypair -keystore $keystore -storetype PKCS12 -alias anybot -keyalg RSA -keysize 4096 `
    -validity 10000 -dname "CN=Any Bot, O=gilfila" -storepass:env ANYBOT_KS_PASS -keypass:env ANYBOT_KS_PASS | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "keytool couldn't create the key." }
  Set-Content -Path $passwordFile -Value $env:ANYBOT_KS_PASS -NoNewline -Encoding ascii

  # Secrets go to GitHub through stdin, never on a command line.
  [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) | gh secret set ANDROID_KEYSTORE_BASE64 -R $repo
  if ($LASTEXITCODE -ne 0) { throw "Couldn't store ANDROID_KEYSTORE_BASE64." }
  $env:ANYBOT_KS_PASS | gh secret set ANDROID_KEYSTORE_PASSWORD -R $repo
  if ($LASTEXITCODE -ne 0) { throw "Couldn't store ANDROID_KEYSTORE_PASSWORD." }
} finally {
  Remove-Item Env:ANYBOT_KS_PASS -ErrorAction SilentlyContinue
}

$fingerprint = (& $keytool -list -v -keystore $keystore -storepass:file $passwordFile -alias anybot |
  Select-String "SHA256:").ToString().Trim()
Write-Host ""
Write-Host "Done. GitHub now has ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD on $repo."
Write-Host "The next release will attach a signed AnyBot-phone.apk."
Write-Host ""
Write-Host "Back up this folder somewhere safe (a password manager or an encrypted drive):"
Write-Host "  $folder"
Write-Host "Future app updates must be signed with this exact key."
Write-Host ""
Write-Host "Certificate $fingerprint"
