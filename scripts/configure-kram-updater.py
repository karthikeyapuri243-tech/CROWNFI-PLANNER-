from pathlib import Path

package_dir = Path("android/app/src/main/java/com/kram/planner")
package_dir.mkdir(parents=True, exist_ok=True)

plugin = r'''package com.kram.planner;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "KramInstaller")
public class KramInstallerPlugin extends Plugin {
    @PluginMethod
    public void canInstallUnknownApps(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallUnknownAppsSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } else {
                Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Android install permission settings.", error);
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        try {
            String filePath = call.getString("filePath");
            if (filePath == null || filePath.isEmpty()) {
                call.reject("APK file path is required.");
                return;
            }
            String actualPath = filePath.startsWith("file://")
                ? Uri.parse(filePath).getPath()
                : filePath;
            File apkFile = new File(actualPath);
            if (!apkFile.isFile()) {
                call.reject("Downloaded KRAM APK was not found.");
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
                call.reject("Allow KRAM to install unknown apps in Android settings first.");
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apkFile
            );
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("completed", true);
            result.put("message", "Android package installer opened.");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not open the Android package installer.", error);
        }
    }
}
'''
(package_dir / "KramInstallerPlugin.java").write_text(plugin)

main_activity = package_dir / "MainActivity.java"
main_activity.write_text('''package com.kram.planner;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KramInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
''')

manifest_path = Path("android/app/src/main/AndroidManifest.xml")
manifest = manifest_path.read_text()
permission = '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />'
if permission not in manifest:
    manifest = manifest.replace("<application", permission + "\n    <application", 1)

provider = '''        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>'''
if "${applicationId}.fileprovider" not in manifest:
    manifest = manifest.replace("</application>", provider + "\n    </application>", 1)
manifest_path.write_text(manifest)

paths = Path("android/app/src/main/res/xml/file_paths.xml")
paths.parent.mkdir(parents=True, exist_ok=True)
paths.write_text('''<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="cache" path="." />
    <files-path name="files" path="." />
</paths>
''')

print("Configured KRAM native APK installer and FileProvider.")
