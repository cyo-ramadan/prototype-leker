package id.ownertenang.penerusqris;

import android.app.Notification;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Membaca notifikasi aplikasi merchant yang diizinkan lalu meneruskannya. Merchant BCA memakai tampilan
 * khusus (judul/teks standar kosong) -- tampilannya "digambar ulang" di belakang layar lalu semua
 * tulisannya dikumpulkan. Hanya paket yang dicentang pemilik yang diteruskan; notifikasi WA dsb.
 * tidak pernah keluar dari HP.
 */
public class PenerusService extends NotificationListenerService {
    private static final long COBA_ULANG_MS = 5 * 60 * 1000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable cobaUlang = new Runnable() {
        @Override public void run() {
            Pengirim.kirimSemua(PenerusService.this);
            handler.postDelayed(this, COBA_ULANG_MS);
        }
    };

    @Override
    public void onListenerConnected() {
        Pengirim.catat(this, "Penerus aktif (akses notifikasi tersambung)");
        handler.removeCallbacks(cobaUlang);
        handler.postDelayed(cobaUlang, COBA_ULANG_MS);
        Pengirim.kirimSemua(this);
    }

    @Override
    public void onListenerDisconnected() {
        handler.removeCallbacks(cobaUlang);
        Pengirim.catat(this, "Penerus terputus dari sistem -- buka aplikasi untuk menyambung lagi");
    }

    static Set<String> paketDiizinkan(Context ctx) {
        Set<String> hasil = new HashSet<>();
        for (String bagian : Pengirim.prefs(ctx).getString(Pengirim.KUNCI_PAKET, Pengirim.PAKET_BAWAAN).split("[,\\s]+")) {
            if (!bagian.trim().isEmpty()) hasil.add(bagian.trim());
        }
        return hasil;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || !paketDiizinkan(this).contains(sbn.getPackageName())) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle extras = n.extras;
            String judul = teks(extras, Notification.EXTRA_TITLE);
            String isi = teks(extras, Notification.EXTRA_BIG_TEXT);
            if (isi.isEmpty()) isi = teks(extras, Notification.EXTRA_TEXT);
            String tampilan = teksTampilanKhusus(n);
            if (isi.isEmpty()) isi = tampilan;
            else if (!tampilan.isEmpty() && !isi.contains(tampilan)) isi = isi + "\n" + tampilan;
            if (judul.isEmpty() && isi.isEmpty()) return;

            JSONObject kiriman = new JSONObject();
            kiriman.put("app", sbn.getPackageName());
            kiriman.put("title", judul);
            kiriman.put("text", isi);
            kiriman.put("postedAt", sbn.getPostTime());
            kiriman.put("id", sbn.getKey() + "|" + sbn.getPostTime());
            Pengirim.catat(this, "Notif " + sbn.getPackageName() + ": " + ringkas(isi));
            Pengirim.antrekan(this, kiriman);
        } catch (Exception e) {
            Pengirim.catat(this, "Gagal membaca notifikasi: " + e.getClass().getSimpleName());
        }
    }

    private static String teks(Bundle extras, String kunci) {
        if (extras == null) return "";
        CharSequence nilai = extras.getCharSequence(kunci);
        return nilai == null ? "" : nilai.toString().trim();
    }

    private static String ringkas(String s) {
        String satu = s.replace('\n', ' ');
        return satu.length() > 70 ? satu.substring(0, 70) + "…" : satu;
    }

    /** Tulisan di tampilan khusus (RemoteViews) notifikasi, mis. Merchant BCA. */
    @SuppressWarnings("deprecation")
    private String teksTampilanKhusus(Notification n) {
        RemoteViews[] calon = { n.bigContentView, n.contentView, n.headsUpContentView };
        for (RemoteViews rv : calon) {
            if (rv == null) continue;
            try {
                FrameLayout wadah = new FrameLayout(this);
                View v = rv.apply(this, wadah);
                StringBuilder sb = new StringBuilder();
                kumpulkan(v, sb);
                String hasil = sb.toString().trim();
                if (!hasil.isEmpty()) return hasil;
            } catch (Throwable ignored) {
                // Tampilan tidak bisa digambar ulang di HP ini -- coba tampilan berikutnya.
            }
        }
        return "";
    }

    private static void kumpulkan(View v, StringBuilder sb) {
        if (v instanceof TextView) {
            CharSequence t = ((TextView) v).getText();
            if (t != null && t.length() > 0) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(t);
            }
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) kumpulkan(g.getChildAt(i), sb);
        }
    }
}
