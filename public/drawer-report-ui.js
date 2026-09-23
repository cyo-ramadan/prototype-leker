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

  function render(report) {
    if (!report?.drawer) return '<div class="empty">Detail laci tidak tersedia.</div>';
    const drawer = report.drawer;
    const sections = report.sections || {};
    const totals = report.totals || {};
    const promoList = moneyList((sections.promotions || []).map(row => [lineName(row.name, row.quantity), row.total]));
    const cookingRows = (sections.cooking || []).length
      ? sections.cooking.map(row => `<tr><td>${esc(row.result || '')}</td><td>${esc(row.material || '')}</td></tr>`).join('')
      : emptyRow(2, 'Belum ada modul Masak pada prototype ini.');
    const stockRows = (sections.stockRemaining || []).length
      ? sections.stockRemaining.map(row => `<tr><td>${esc(row.productName)}</td><td>${number(row.openingStock)}</td><td>${number(row.closingStock)}</td></tr>`).join('')
      : emptyRow(3, 'Belum ada inventory ledger untuk snapshot stok laci.');
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
        ['Saldo Pulang', drawer.closingAmount],
        ['Selisih Kas', totals.cashDifference]
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
