(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const number = value => new Intl.NumberFormat('id-ID').format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';

  const emptyRow = (columns, text = 'Belum ada data pada laci ini.') => `<tr><td colspan="${columns}" class="drawer-report-empty">${esc(text)}</td></tr>`;
  const table = (headers, rows) => `<div class="drawer-report-table-wrap"><table class="drawer-report-table"><thead><tr>${headers.map(label => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

  // Bos Cyo, 2026-09-14: baris "barang : biaya" (Penjualan, Promosi,
  // Pembelian, Operasional, Perhitungan) di Detail Laci dulu dirender
  // sebagai <table> dengan lebar minimum tetap -- di layar HP yang sempit
  // itu selalu lebih lebar dari layar, jadi kolom nominal di kanan ketutup
  // / harus digeser tanpa pemakai sadar. Diganti daftar 2 kolom fleksibel:
  // nama melebar penuh (bisa turun baris kalau panjang), nominal selalu
  // rapat kanan -- tanpa garis sekat kolom, jadi tidak pernah kepotong
  // di lebar layar berapa pun.
  const moneyList = (items, emptyText = 'Belum ada data pada laci ini.') => items.length
    ? `<div class="drawer-line-list">${items.map(([name, amount]) => `<div class="drawer-line-row"><span>${esc(name)}</span><span class="drawer-line-amount">${amount == null ? '-' : rupiah(amount)}</span></div>`).join('')}</div>`
    : `<div class="drawer-line-empty">${esc(emptyText)}</div>`;
  const lineName = (name, quantity) => (quantity != null && Number(quantity) !== 1) ? `${name} ×${number(quantity)}` : name;

  function salesTable(rows, total, itemCount) {
    const body = moneyList(rows.map(row => [lineName(row.productName, row.quantity), row.total]));
    return `${body}<div class="drawer-report-total">Total (${number(itemCount)} item) <b>${rupiah(total)}</b></div>`;
  }

  function purchaseTable(rows, total) {
    const body = moneyList(rows.map(row => [String(row.description || '').replace(/^Pembelian\s+/i, ''), row.totalAmount]));
    return `${body}<div class="drawer-report-total">Total <b>${rupiah(total)}</b></div>`;
  }

  function expenseTable(rows, total) {
    const body = moneyList(rows.map(row => [row.description, row.amount]));
    return `${body}<div class="drawer-report-total">Total <b>${rupiah(total)}</b></div>`;
  }

  function section(title, content) {
    return `<section class="drawer-report-section"><h4>${esc(title)}</h4>${content}</section>`;
  }

  // Bos Cyo, 2026-09-28: tombol Salin di Detail Laci -- format teks siap
  // ditempel ke WA, dari data yang SAMA dengan yang sudah ditampilkan di
  // atas (bukan field tambahan yang tidak ada di tampilan). Dipakai baik
  // dari sisi Kasir maupun Admin karena render() ini satu-satunya sumber
  // untuk dua-duanya.
  let lastReportForCopy = null;
  const plain = value => String(value ?? '').replace(/\|/g, '-').replace(/[\r\n]+/g, ' ').trim();
  const textMoneyLines = (items, emptyText = '(kosong)') => items.length
    ? items.map(([name, amount]) => `${plain(name)} | ${amount == null ? '-' : number(amount)}`).join('\n')
    : emptyText;
  const textTableLines = (rows, emptyText = '(kosong)') => rows.length ? rows.map(cells => cells.map(plain).join(' | ')).join('\n') : emptyText;

  function textSalesSection(rows, total, itemCount) {
    const lines = rows.length ? rows.map(row => {
      const qty = Number(row.quantity) || 0;
      const amount = Number(row.total) || 0;
      const unit = qty ? Math.round(amount / qty) : amount;
      return `${plain(row.productName)} | ${number(qty)}x${number(unit)}=${number(amount)}`;
    }) : ['(kosong)'];
    lines.push(`Total (${number(itemCount)} item) | ${number(total)}`);
    return lines.join('\n');
  }

  function textPurchaseSection(rows, total) {
    const lines = rows.length ? rows.map(row => `${plain(String(row.description || '').replace(/^Pembelian\s+/i, ''))} | ${number(row.totalAmount)}`) : ['(kosong)'];
    lines.push(`Total | ${number(total)}`);
    return lines.join('\n');
  }

  function textExpenseSection(rows, total) {
    const lines = rows.length ? rows.map(row => `${plain(row.description)} | ${number(row.amount)}`) : ['(kosong)'];
    lines.push(`Total | ${number(total)}`);
    return lines.join('\n');
  }

  function buildCopyText(report) {
    const drawer = report.drawer;
    const sections = report.sections || {};
    const totals = report.totals || {};
    const lines = [
      `ID Laci: ${drawer.id}`,
      `Shift: ${drawer.shiftLabel || '-'}`,
      `Penanggung jawab: ${drawer.cashierName || '-'} (@${drawer.cashierUsername || '-'})`,
      `Datang: ${dateTime(drawer.openedAt)}`,
      `Pulang: ${dateTime(drawer.closedAt)}`,
      `Modal: ${rupiah(drawer.openingAmount)}`,
      `Insentif: ${rupiah(drawer.incentiveAmount)}`,
      `Status: ${drawer.status}`
    ];
    if (drawer.openingNote) lines.push(`Keterangan Buka: ${plain(drawer.openingNote)}`);
    if (drawer.closingNote) lines.push(`Keterangan Pulang: ${plain(drawer.closingNote)}`);
    lines.push('');

    lines.push('1. PENJUALAN BAYAR TUNAI', 'PRODUK | TERJUAL', textSalesSection(sections.cashSales || [], totals.cashSales, totals.cashSalesItems), '');
    lines.push('2. PROMOSI', 'NAMA | JUMLAH | TOTAL', textTableLines((sections.promotions || []).map(row => [row.name, number(row.quantity), row.total]), '(kosong)'), `Total | ${number(totals.promotions)}`, '');
    lines.push('3A. BELANJA BAHAN BAYAR TUNAI', 'PRODUK | TOTAL', textPurchaseSection(sections.cashPurchases || [], totals.cashPurchases), '');
    lines.push('4.1 OPERASIONAL KAS', 'Keterangan | Total', textExpenseSection(sections.cashExpenses || [], totals.cashExpenses), '');
    lines.push('4.2 OPERASIONAL NON KAS', 'Keterangan | Total', textExpenseSection(sections.nonCashExpenses || [], totals.nonCashExpenses), '');
    lines.push('5. MASAK', 'HASIL | BAHAN BAKU', textTableLines((sections.cooking || []).map(row => [row.result || '', row.material || '']), 'Belum ada catatan masak.'), '');
    lines.push('6. STOK SISA', 'PRODUK | STOK AWAL | STOK AKHIR', textTableLines((sections.stockRemaining || []).map(row => [row.productName, number(row.openingStock), number(row.closingStock)]), 'Belum ada catatan stok untuk laci ini.'), '');

    lines.push('PERHITUNGAN', textMoneyLines([
      ['Penjualan Tunai (Plus)', totals.cashSales],
      ['Promosi (Minus)', totals.promotions],
      ['Pendapatan Riil Tunai', totals.realCashRevenue],
      ['Modal', drawer.openingAmount],
      ['Belanja Bahan Tunai (Minus)', totals.cashPurchases],
      ['Operasional Kas (Minus)', totals.cashExpenses],
      ['Pendapatan Lain (Plus)', totals.cashIn],
      ['Arus Kas Masuk (Plus)', totals.operationalCashIn],
      ['Arus Kas Keluar (Minus)', totals.operationalCashOut],
      ['Ekspektasi Di Laci', totals.expectedCash],
      ['Uang di laci saat tutup (hitung fisik)', drawer.closingAmount],
      ['Taruh uang laci (modal shift berikutnya)', totals.leftInDrawerAmount],
      ['Setoran (dibawa CS, jadi piutang setoran)', totals.depositAmount],
      ...(totals.cashDifference ? [['Lebih (+) / kurang (−) dari ekspektasi', totals.cashDifference]] : [])
    ]), '');

    lines.push('----- CATATAN TAMBAHAN -----', '');
    lines.push('1B. PENJUALAN BAYAR NON TUNAI', 'PRODUK | TERJUAL', textSalesSection(sections.nonCashSales || [], totals.nonCashSales, totals.nonCashSalesItems), '');
    lines.push('3B. BELANJA BAHAN BAYAR NON TUNAI', 'PRODUK | TOTAL', textPurchaseSection(sections.nonCashPurchases || [], totals.nonCashPurchases), '');
    lines.push('PENYESUAIAN STOK', 'PRODUK | Stok Tercatat | Stok Riil | Selisih', textTableLines((sections.stockAdjustments || []).map(row => [row.productName, number(row.recordedStock), number(row.actualStock), number(row.difference)]), 'Belum ada penyesuaian stok.'), '');
    lines.push('ARUS BARANG', 'BARANG | ARAH | QTY | KETERANGAN', textTableLines((sections.goodsFlow || []).map(row => [row.productName, row.direction === 'OUT' ? 'Keluar' : 'Masuk', `${number(row.quantity)}${row.unitSymbol ? ` ${row.unitSymbol}` : ''}`, row.sharedAccountName ? `${row.note || 'Arus Barang'} - Rekening Bersama: ${row.sharedAccountName}` : (row.note || '-')]), 'Belum ada Arus Barang.'), '');
    lines.push('PENDAPATAN LAIN', 'Tanggal | Jumlah | Keterangan | Akun Kas | Akun Pendapatan', textTableLines((sections.cashIn || []).map(row => [dateTime(row.createdAt), number(row.amount), row.description, row.cashAccount || '-', row.incomeAccount || '-']), '(kosong)'), '');
    lines.push('ARUS KAS MASUK', textMoneyLines((sections.operationalCash || []).filter(row => row.direction === 'IN').map(row => [row.description || row.note || 'Arus Kas', row.amount]), '(kosong)'), `Total | ${number(totals.operationalCashIn)}`, '');
    lines.push('ARUS KAS KELUAR', textMoneyLines((sections.operationalCash || []).filter(row => row.direction === 'OUT').map(row => [row.description || row.note || 'Arus Kas', row.amount]), '(kosong)'), `Total | ${number(totals.operationalCashOut)}`);

    return lines.join('\n');
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch { return false; }
    }
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-drawer-report-copy]');
    if (!button || !lastReportForCopy) return;
    const original = button.textContent;
    const ok = await copyToClipboard(buildCopyText(lastReportForCopy));
    button.textContent = ok ? '✅ Disalin' : '⚠️ Gagal menyalin';
    setTimeout(() => { button.textContent = original; }, 1600);
  });

  function render(report) {
    if (!report?.drawer) return '<div class="empty">Detail laci tidak tersedia.</div>';
    lastReportForCopy = report;
    const drawer = report.drawer;
    const sections = report.sections || {};
    const totals = report.totals || {};
    const promoList = moneyList((sections.promotions || []).map(row => [lineName(row.name, row.quantity), row.total]));
    const cookingRows = (sections.cooking || []).length
      ? sections.cooking.map(row => `<tr><td>${esc(row.result || '')}</td><td>${esc(row.material || '')}</td></tr>`).join('')
      : emptyRow(2, 'Belum ada catatan masak.');
    const stockRows = (sections.stockRemaining || []).length
      ? sections.stockRemaining.map(row => `<tr><td>${esc(row.productName)}</td><td>${number(row.openingStock)}</td><td>${number(row.closingStock)}</td></tr>`).join('')
      : emptyRow(3, 'Belum ada catatan stok untuk laci ini.');
    const adjustmentRows = (sections.stockAdjustments || []).length
      ? sections.stockAdjustments.map(row => `<tr><td>${esc(row.productName)}</td><td>${number(row.recordedStock)}</td><td>${number(row.actualStock)}</td><td>${number(row.difference)}</td></tr>`).join('')
      : emptyRow(4, 'Belum ada penyesuaian stok.');
    // Bos Cyo, 2026-09-23: "arus barang belum masuk ke laporan laci". Ini
    // pergerakan barang biasa (barang masuk/keluar, misal transfer antar
    // gerai) -- bukan Penyesuaian Stok, jadi tidak punya "stok tercatat vs
    // stok riil", cuma arah + qty. Ditaruh satu kategori dengan Penyesuaian
    // Stok (sama-sama pergerakan barang, bukan uang, jadi tidak masuk ke
    // PERHITUNGAN kas).
    const goodsFlowLabel = row => row.sharedAccountName
      ? `${row.note || 'Arus Barang'} · Rekening Bersama: ${row.sharedAccountName}`
      : (row.note || '-');
    const goodsFlowRows = (sections.goodsFlow || []).length
      ? sections.goodsFlow.map(row => `<tr><td>${esc(row.productName)}</td><td>${row.direction === 'OUT' ? 'Keluar' : 'Masuk'}</td><td>${number(row.quantity)}${row.unitSymbol ? ` ${esc(row.unitSymbol)}` : ''}</td><td>${esc(goodsFlowLabel(row))}</td></tr>`).join('')
      : emptyRow(4, 'Belum ada Arus Barang.');
    const cashInRows = (sections.cashIn || []).length
      ? sections.cashIn.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td>${rupiah(row.amount)}</td><td>${esc(row.description)}</td><td>${esc(row.cashAccount || '-')}</td><td>${esc(row.incomeAccount || '-')}</td></tr>`).join('')
      : emptyRow(5);
    // Bos Cyo, 2026-09-15: Arus Kas (cash_ledger_entries, direction IN/OUT)
    // sudah lama ikut dihitung server (masuk ke Ekspektasi Di Laci), tapi
    // baris-barisnya tidak pernah dirender di sini sama sekali -- laporan
    // menampilkan hasil akhirnya tanpa menunjukkan input yang membentuknya.
    // Murni bolong di tampilan, bukan di hitungan.
    const cashFlowLabel = row => row.description || row.note || 'Arus Kas';
    const cashFlowIn = moneyList((sections.operationalCash || []).filter(row => row.direction === 'IN').map(row => [cashFlowLabel(row), row.amount]));
    const cashFlowOut = moneyList((sections.operationalCash || []).filter(row => row.direction === 'OUT').map(row => [cashFlowLabel(row), row.amount]));

    return `<div class="drawer-report">
      <div class="drawer-report-header">
        <button type="button" class="drawer-report-copy-btn" data-drawer-report-copy title="Salin detail laci untuk ditempel ke WhatsApp">📋 Salin</button>
        <div><span>ID Laci</span><b>${esc(drawer.id)}</b></div>
        <div><span>Penanggung jawab</span><b>${esc(drawer.cashierName || '-')} · @${esc(drawer.cashierUsername || '-')}</b></div>
        <div><span>Shift</span><b>${esc(drawer.shiftLabel || '-')}</b></div>
        <div><span>Datang</span><b>${dateTime(drawer.openedAt)}</b></div>
        <div><span>Pulang</span><b>${dateTime(drawer.closedAt)}</b></div>
        <div><span>Modal</span><b>${rupiah(drawer.openingAmount)}</b></div>
        <div><span>Insentif</span><b>${rupiah(drawer.incentiveAmount)}</b></div>
        <div><span>Status</span><b>${esc(drawer.status)}</b></div>
      </div>
      ${drawer.openingNote ? `<div class="drawer-report-note"><b>Keterangan Buka:</b> ${esc(drawer.openingNote)}</div>` : ''}
      ${drawer.closingNote ? `<div class="drawer-report-note"><b>Keterangan Pulang:</b> ${esc(drawer.closingNote)}</div>` : ''}

      ${section('1. PENJUALAN BAYAR TUNAI', salesTable(sections.cashSales || [], totals.cashSales, totals.cashSalesItems))}
      ${section('2. PROMOSI', `${promoList}<div class="drawer-report-total">Total <b>${rupiah(totals.promotions)}</b></div>`)}
      ${section('3A. BELANJA BAHAN BAYAR TUNAI', purchaseTable(sections.cashPurchases || [], totals.cashPurchases))}
      ${section('4.1 OPERASIONAL KAS', expenseTable(sections.cashExpenses || [], totals.cashExpenses))}
      ${section('4.2 OPERASIONAL NON KAS', expenseTable(sections.nonCashExpenses || [], totals.nonCashExpenses))}
      ${section('5. MASAK', table(['HASIL', 'BAHAN BAKU'], cookingRows))}
      ${section('6. STOK SISA', table(['PRODUK', 'STOK AWAL', 'STOK AKHIR'], stockRows))}

      ${section('PERHITUNGAN', moneyList([
        ['Penjualan Tunai (Plus)', totals.cashSales],
        ['Promosi (Minus)', totals.promotions],
        ['Pendapatan Riil Tunai', totals.realCashRevenue],
        ['Modal', drawer.openingAmount],
        ['Belanja Bahan Tunai (Minus)', totals.cashPurchases],
        ['Operasional Kas (Minus)', totals.cashExpenses],
        ['Pendapatan Lain (Plus)', totals.cashIn],
        ['Arus Kas Masuk (Plus)', totals.operationalCashIn],
        ['Arus Kas Keluar (Minus)', totals.operationalCashOut],
        ['Ekspektasi Di Laci', totals.expectedCash],
        ['Uang di laci saat tutup (hitung fisik)', drawer.closingAmount],
        ['Taruh uang laci (modal shift berikutnya)', totals.leftInDrawerAmount],
        ['Setoran (dibawa CS, jadi piutang setoran)', totals.depositAmount],
        ...(totals.cashDifference ? [['Lebih (+) / kurang (−) dari ekspektasi', totals.cashDifference]] : [])
      ]))}

      <div class="drawer-report-divider">CATATAN TAMBAHAN</div>
      ${section('1B. PENJUALAN BAYAR NON TUNAI', salesTable(sections.nonCashSales || [], totals.nonCashSales, totals.nonCashSalesItems))}
      ${section('3B. BELANJA BAHAN BAYAR NON TUNAI', purchaseTable(sections.nonCashPurchases || [], totals.nonCashPurchases))}
      ${section('PENYESUAIAN STOK', table(['PRODUK', 'Stok Tercatat', 'Stok Riil', 'Selisih'], adjustmentRows))}
      ${section('ARUS BARANG', table(['BARANG', 'ARAH', 'QTY', 'KETERANGAN'], goodsFlowRows))}
      ${section('PENDAPATAN LAIN', table(['Tanggal', 'Jumlah', 'Keterangan', 'Akun Kas', 'Akun Pendapatan'], cashInRows))}
      ${section('ARUS KAS MASUK', `${cashFlowIn}<div class="drawer-report-total">Total <b>${rupiah(totals.operationalCashIn)}</b></div>`)}
      ${section('ARUS KAS KELUAR', `${cashFlowOut}<div class="drawer-report-total">Total <b>${rupiah(totals.operationalCashOut)}</b></div>`)}
    </div>`;
  }

  window.MAXIDrawerReport = { render };
})();
