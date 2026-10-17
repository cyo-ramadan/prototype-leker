package id.ownertenang.penerusqris;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Satu layar: status izin, alamat penerima, aplikasi yang diteruskan, kirim tes, dan catatan terakhir.
 * Sengaja tanpa XML/pustaka supaya bisa dirakit tanpa Gradle.
 */
public class MainActivity extends Activity {
    private TextView statusAkses;
    private TextView statusBaterai;
    private TextView statusAntrean;
    private TextView catatan;
    private EditText alamat;
    private EditText paket;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int pad = dp(16);
        LinearLayout akar = new LinearLayout(this);
        akar.setOrientation(LinearLayout.VERTICAL);
        akar.setPadding(pad, pad, pad, pad);

        akar.addView(judul("Penerus QRIS", 22));
        akar.addView(keterangan("Meneruskan notifikasi uang masuk dari aplikasi merchant QRIS (mis. Merchant BCA) di HP ini ke kolam QRIS. Notifikasi aplikasi lain tidak pernah dikirim."));

        akar.addView(judul("1. Akses notifikasi", 16));
        statusAkses = keterangan("");
        akar.addView(statusAkses);
        akar.addView(tombol("Buka pengaturan akses notifikasi", v ->
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))));

        akar.addView(judul("2. Baterai", 16));
        statusBaterai = keterangan("");
        akar.addView(statusBaterai);
        akar.addView(tombol("Jangan batasi baterai aplikasi ini", v -> mintaBebasBaterai()));

        akar.addView(judul("3. Alamat penerima", 16));
        akar.addView(keterangan("Salin dari Entity Admin → 📲 QRIS → ⚙️ Setelan → Buat HP penerima (diawali https:// dan berisi token=qr_…)."));
        alamat = new EditText(this);
        alamat.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        alamat.setHint("https://…/api/qris/masuk?token=qr_…");
        akar.addView(alamat);
        LinearLayout baris = new LinearLayout(this);
        baris.addView(tombol("Tempel", v -> tempel()));
        baris.addView(tombol("Simpan", v -> simpan()));
        baris.addView(tombol("Kirim tes", v -> kirimTes()));
        akar.addView(baris);

        akar.addView(judul("4. Aplikasi yang diteruskan", 16));
        akar.addView(keterangan("Nama paket, pisahkan dengan koma. Bawaan: com.bca.msb (Merchant BCA)."));
        paket = new EditText(this);
        paket.setInputType(InputType.TYPE_CLASS_TEXT);
        akar.addView(paket);

        akar.addView(judul("Catatan terakhir", 16));
        statusAntrean = keterangan("");
        akar.addView(statusAntrean);
        catatan = keterangan("");
        catatan.setTypeface(Typeface.MONOSPACE);
        akar.addView(catatan);
        akar.addView(tombol("Muat ulang", v -> segarkan()));

        ScrollView gulung = new ScrollView(this);
        gulung.addView(akar);
        setContentView(gulung);

        alamat.setText(Pengirim.prefs(this).getString(Pengirim.KUNCI_ALAMAT, ""));
        paket.setText(Pengirim.prefs(this).getString(Pengirim.KUNCI_PAKET, Pengirim.PAKET_BAWAAN));
    }

    @Override
    protected void onResume() {
        super.onResume();
        segarkan();
        Pengirim.kirimSemua(this);
    }

    private void segarkan() {
        boolean akses = punyaAksesNotifikasi();
        statusAkses.setText(akses ? "✅ Diizinkan" : "❌ Belum diizinkan — tekan tombol di bawah, aktifkan \"Penerus QRIS\".");
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        boolean bebas = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        statusBaterai.setText(bebas ? "✅ Tidak dibatasi" : "❌ Masih dibatasi — notifikasi bisa telat. Tekan tombol di bawah.");
        statusAntrean.setText("Menunggu terkirim: " + Pengirim.jumlahAntrean(this));
        try {
            JSONArray log = new JSONArray(Pengirim.prefs(this).getString(Pengirim.KUNCI_LOG, "[]"));
            StringBuilder sb = new StringBuilder();
            for (int i = log.length() - 1; i >= 0; i--) sb.append(log.getString(i)).append('\n');
            catatan.setText(sb.length() == 0 ? "(belum ada)" : sb.toString());
        } catch (Exception e) {
            catatan.setText("");
        }
    }

    private boolean punyaAksesNotifikasi() {
        String aktif = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return aktif != null && aktif.contains(new ComponentName(this, PenerusService.class).flattenToString());
    }

    private void mintaBebasBaterai() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private void tempel() {
        ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData data = cb == null ? null : cb.getPrimaryClip();
        if (data != null && data.getItemCount() > 0 && data.getItemAt(0).getText() != null) {
            alamat.setText(data.getItemAt(0).getText().toString().trim());
        }
    }

    private boolean simpan() {
        String a = alamat.getText().toString().trim();
        if (!a.startsWith("https://") || !a.contains("/api/qris/masuk") || !a.contains("token=qr_")) {
            Toast.makeText(this, "Alamat belum benar: harus https://…/api/qris/masuk?token=qr_…", Toast.LENGTH_LONG).show();
            return false;
        }
        String p = paket.getText().toString().trim();
        Pengirim.prefs(this).edit()
            .putString(Pengirim.KUNCI_ALAMAT, a)
            .putString(Pengirim.KUNCI_PAKET, p.isEmpty() ? Pengirim.PAKET_BAWAAN : p)
            .apply();
        Toast.makeText(this, "Tersimpan", Toast.LENGTH_SHORT).show();
        return true;
    }

    private void kirimTes() {
        if (!simpan()) return;
        try {
            JSONObject tes = new JSONObject();
            tes.put("text", "tes");
            Pengirim.antrekan(this, tes);
            Toast.makeText(this, "Tes dikirim — tekan Muat ulang beberapa detik lagi", Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
        }
    }

    private TextView judul(String t, int sp) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(sp);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        v.setPadding(0, dp(14), 0, dp(4));
        return v;
    }

    private TextView keterangan(String t) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(14);
        return v;
    }

    private Button tombol(String t, View.OnClickListener aksi) {
        Button b = new Button(this);
        b.setText(t);
        b.setAllCaps(false);
        b.setOnClickListener(aksi);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
