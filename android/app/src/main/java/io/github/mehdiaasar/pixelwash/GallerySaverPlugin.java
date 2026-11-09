package io.github.mehdiaasar.pixelwash;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Copies a finished video from the app cache into the shared Movies/Pixelwash folder through MediaStore,
 * so it shows up in Gallery / Google Photos. No storage permission is needed on Android 10+ (minSdk 29).
 */
@CapacitorPlugin(name = "GallerySaver")
public class GallerySaverPlugin extends Plugin {

    static final String FOLDER = Environment.DIRECTORY_MOVIES + "/Pixelwash";

    @PluginMethod
    public void saveVideo(PluginCall call) {
        String path = call.getString("path");
        String name = call.getString("name");
        String mime = call.getString("mime", "video/mp4");
        if (path == null || name == null) { call.reject("path and name are required"); return; }
        File src = new File(path);
        try {
            // only files this app wrote to its own cache can be published
            String cache = getContext().getCacheDir().getCanonicalPath() + File.separator;
            if (!src.getCanonicalPath().startsWith(cache) || !src.isFile()) { call.reject("File not found in the app cache"); return; }
        } catch (IOException e) { call.reject(e.getMessage()); return; }

        new Thread(() -> {
            ContentResolver cr = getContext().getContentResolver();
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            cv.put(MediaStore.Video.Media.MIME_TYPE, mime);
            cv.put(MediaStore.Video.Media.RELATIVE_PATH, FOLDER);
            cv.put(MediaStore.Video.Media.IS_PENDING, 1);
            Uri uri = null;
            try {
                uri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), cv);
                if (uri == null) throw new IOException("the gallery refused the new file");
                try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new IOException("cannot open the gallery file");
                    byte[] buf = new byte[1 << 20];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Video.Media.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                ret.put("folder", FOLDER);
                call.resolve(ret);
            } catch (Exception e) {
                if (uri != null) { try { cr.delete(uri, null, null); } catch (Exception ignored) { } }
                call.reject("Could not save to the gallery: " + e.getMessage());
            }
        }).start();
    }
}
