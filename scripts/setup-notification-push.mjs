// Generates new key material only when explicitly requested with --json.
// Pipe stdout directly into `wrangler secret bulk`; never capture it in tool logs.
// Inspect existing secret NAMES first. Regenerating breaks existing subscriptions.
import { pathToFileURL } from 'node:url';

export async function generateNotificationPushSecrets(subject) {
  let parsed;
  try { parsed = new URL(subject); } catch { throw new Error('Subject harus berupa mailto: atau URL HTTPS publik.'); }
  if (!['mailto:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Subject harus berupa mailto: atau URL HTTPS publik.');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = btoa(String.fromCharCode(...raw)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: parsed.href };
}

export async function runSetupNotificationPush(args = process.argv.slice(2), io = process) {
  const subjectIndex = args.indexOf('--subject');
  const allowed = args.includes('--json') && subjectIndex >= 0 && args[subjectIndex + 1];
  if (!allowed || args.length !== 3) {
    io.stderr.write('Penggunaan: node scripts/setup-notification-push.mjs --json --subject mailto:admin@example.com | npx wrangler secret bulk\n');
    io.stderr.write('Periksa nama secret yang sudah ada dahulu; jangan rotasi key yang masih digunakan. Tanpa --json tidak ada key yang dibuat atau ditampilkan.\n');
    return 1;
  }
  if (io.stdout.isTTY) {
    io.stderr.write('Output berisi private key. Gunakan pipe langsung ke pengelola secret, bukan terminal.\n');
    return 1;
  }
  try {
    const secrets = await generateNotificationPushSecrets(args[subjectIndex + 1]);
    io.stdout.write(JSON.stringify(secrets));
    return 0;
  } catch {
    io.stderr.write('Pembuatan VAPID gagal. Pastikan subject valid dan WebCrypto tersedia.\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runSetupNotificationPush();
