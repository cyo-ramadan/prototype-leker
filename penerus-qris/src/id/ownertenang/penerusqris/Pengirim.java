package id.ownertenang.penerusqris;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Antrean + pengiriman ke alamat penerima (POST JSON). Notifikasi yang gagal terkirim (HP offline,
 * server sibuk) disimpan dan dicoba lagi -- uang masuk tidak boleh hilang hanya karena sinyal putus.
 * Server menolak kiriman dobel lewat "id" unik per notifikasi, jadi kirim ulang aman.
 */
final class Pengirim {
    static final String PREFS = "penerus";
    static final String KUNCI_ALAMAT = "alamat";
    static final String KUNCI_PAKET = "paket";
    static final String KUNCI_ANTREAN = "antrean";
    static final String KUNCI_LOG = "log";
    static final String PAKET_BAWAAN = "com.bca.msb";
    private static final int MAKS_ANTREAN = 300;
    private static final int MAKS_LOG = 15;
    private static final ExecutorService PEKERJA = Executors.newSingleThreadExecutor();

    private Pengirim() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void antrekan(Context ctx, JSONObject isi) {
        try {
            SharedPreferences p = prefs(ctx);
            JSONArray antrean = new JSONArray(p.getString(KUNCI_ANTREAN, "[]"));
            antrean.put(isi);
            while (antrean.length() > MAKS_ANTREAN) antrean.remove(0);
            p.edit().putString(KUNCI_ANTREAN, antrean.toString()).apply();
        } catch (Exception ignored) {
        }
        kirimSemua(ctx);
    }

    static int jumlahAntrean(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KUNCI_ANTREAN, "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Kirim semua yang menunggu, berurutan, di utas latar. Berhenti di kegagalan pertama (coba lagi nanti). */
    static void kirimSemua(final Context ctx) {
        final Context app = ctx.getApplicationContext();
        PEKERJA.execute(() -> {
            String alamat = prefs(app).getString(KUNCI_ALAMAT, "");
            if (alamat.isEmpty()) return;
            while (true) {
                JSONObject pertama;
                synchronized (Pengirim.class) {
                    try {
                        JSONArray antrean = new JSONArray(prefs(app).getString(KUNCI_ANTREAN, "[]"));
                        if (antrean.length() == 0) return;
                        pertama = antrean.getJSONObject(0);
                    } catch (Exception e) {
                        prefs(app).edit().putString(KUNCI_ANTREAN, "[]").apply();
                        return;
                    }
                }
                Hasil hasil = kirim(alamat, pertama);
                if (!hasil.selesai) {
                    catat(app, "Gagal kirim (" + hasil.pesan + "), dicoba lagi nanti");
                    return;
                }
                synchronized (Pengirim.class) {
                    try {
                        JSONArray antrean = new JSONArray(prefs(app).getString(KUNCI_ANTREAN, "[]"));
                        if (antrean.length() > 0) antrean.remove(0);
                        prefs(app).edit().putString(KUNCI_ANTREAN, antrean.toString()).apply();
                    } catch (Exception ignored) {
                    }
                }
                catat(app, hasil.pesan);
            }
        });
    }

    static final class Hasil {
        final boolean selesai;
        final String pesan;
        Hasil(boolean selesai, String pesan) { this.selesai = selesai; this.pesan = pesan; }
    }

    /**
     * selesai = server sudah memutuskan (diterima, dobel, atau ditolak permanen 4xx) -> buang dari antrean.
     * 5xx / jaringan putus -> simpan, coba lagi.
     */
    static Hasil kirim(String alamat, JSONObject isi) {
        HttpURLConnection koneksi = null;
        try {
            koneksi = (HttpURLConnection) new URL(alamat).openConnection();
            koneksi.setRequestMethod("POST");
            koneksi.setConnectTimeout(10000);
            koneksi.setReadTimeout(15000);
            koneksi.setDoOutput(true);
            koneksi.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] badan = isi.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream keluar = koneksi.getOutputStream()) { keluar.write(badan); }
            int kode = koneksi.getResponseCode();
            String jawaban = baca(kode >= 400 ? koneksi.getErrorStream() : koneksi.getInputStream());
            String ringkas = ringkasJawaban(jawaban);
            if (kode >= 500) return new Hasil(false, "server " + kode);
            if (kode >= 400) return new Hasil(true, "Ditolak server " + kode + ": " + ringkas);
            return new Hasil(true, ringkas);
        } catch (Exception e) {
            return new Hasil(false, e.getClass().getSimpleName());
        } finally {
            if (koneksi != null) koneksi.disconnect();
        }
    }

    private static String baca(InputStream masuk) {
        if (masuk == null) return "";
        try (InputStream in = masuk) {
            byte[] buf = new byte[4096];
            int n = in.read(buf);
            return n > 0 ? new String(buf, 0, n, StandardCharsets.UTF_8) : "";
        } catch (Exception e) {
            return "";
        }
    }

    private static String ringkasJawaban(String json) {
        try {
            JSONObject o = new JSONObject(json);
            if (o.optBoolean("test")) return "Tes sambungan berhasil";
            if (o.optBoolean("duplicate")) return "Sudah pernah terkirim (dobel diabaikan)";
            if (o.optBoolean("ignored")) return "Diabaikan server: " + o.optString("reason");
            if (o.has("amount")) {
                String gerai = o.isNull("storeCode") ? "kolam bersama" : o.optString("storeCode");
                return "Terkirim Rp" + String.format(Locale.US, "%,d", o.optLong("amount")).replace(',', '.') + " -> " + gerai;
            }
            if (o.has("error")) return o.optString("error");
        } catch (Exception ignored) {
        }
        return json.length() > 80 ? json.substring(0, 80) : json;
    }

    static synchronized void catat(Context ctx, String pesan) {
        try {
            SharedPreferences p = prefs(ctx);
            JSONArray log = new JSONArray(p.getString(KUNCI_LOG, "[]"));
            String jam = new SimpleDateFormat("dd/MM HH:mm:ss", new Locale("id", "ID")).format(new Date());
            log.put(jam + "  " + pesan);
            while (log.length() > MAKS_LOG) log.remove(0);
            p.edit().putString(KUNCI_LOG, log.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
