(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const number = value => new Intl.NumberFormat('id-ID').format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';

  const emptyRow = (columns, text = 'Belum ada data pada laci ini.') => `<tr><td colspan="${columns}" class="drawer-report-empty">${esc(text)}</td></tr>`;
  const table = (headers, rows) => `<div class="drawer-report-table-wrap"><table class="drawer-report-table"><thead><tr>${headers.map(label => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

  function salesTable(rows, total, itemCount) {
    const body = rows.length ? rows.map(row => `<tr><td>${esc(row.productName)}</td><td>${number(row.quantity)} × ${rupiah(row.unitPrice)} = ${rupiah(row.total)}</td></tr>`).join('') : emptyRow(2);
    return `${table(['PRODUK', 'TERJUAL'], body)}<div class="drawer-report-total">Total (${number(itemCount)} item) <b>${rupiah(total)}</b></div>`;
  }

  function purchaseTable(rows, total) {
    const body = rows.length ? rows.map(row => `<tr><td>${esc(row.description)}</td><td>${esc(row.supplierName || '-')}</td><td>${rupiah(row.totalAmount)}</td></tr>`).join('') : emptyRow(3);
    return `${table(['PRODUK / KETERANGAN', 'SUPPLIER', 'TOTAL'], body)}<div class="drawer-report-total">Total <b>${rupiah(total)}</b></div>`;
  }

  function expenseTable(rows, total) {
    const body = rows.length ? rows.map(row => `<tr><td>${esc(row.description)}</td><td>${rupiah(row.amount)}</td></tr>`).join('') : emptyRow(2);
    return `${table(['Keterangan', 'Total'], body)}<div class="drawer-report-total">Total <b>${rupiah(total)}</b></div>`;
  }

  function section(title, content) {
    return `<section class="drawer-report-section"><h4>${esc(title)}</h4>${content}</section>`;
  }

  function render(report) {
    if (!report?.drawer) return '<div class="empty">Detail laci tidak tersedia.</div>';
    const drawer = report.drawer;
    const sections = report.sections || {};
    const totals = report.totals || {};
    const promoRows = (sections.promotions || []).length
      ? (sections.promotions || []).map(row => `<tr><td>${esc(row.name)}</td><td>${number(row.quantity)}</td><td>${rupiah(row.total)}</td></tr>`).join('')
      : emptyRow(3);
    const cookingRows = (sections.cooking || []).length
      ? sections.cooking.map(row => `<tr><td>${esc(row.result || '')}</td><td>${esc(row.material || '')}</td></tr>`).join('')
      : emptyRow(2, 'Belum ada modul Masak pada prototype ini.');
    const stockRows = (sections.stockRemaining || []).length
      ? sections.stockRemaining.map(row => `<tr><td>${esc(row.productName)}</td><td>${number(row.openingStock)}</td><td>${number(row.closingStock)}</td></tr>`).join('')
      : emptyRow(3, 'Belum ada inventory ledger untuk snapshot stok laci.');
    const adjustmentRows = (sections.stockAdjustments || []).length
      ? sections.stockAdjustments.map(row => `<tr><td>${esc(row.productName)}</td><td>${number(row.recordedStock)}</td><td>${number(row.actualStock)}</td><td>${number(row.difference)}</td></tr>`).join('')
      : emptyRow(4, 'Belum ada penyesuaian stok.');
    const cashInRows = (sections.cashIn || []).length
      ? sections.cashIn.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td>${rupiah(row.amount)}</td><td>${esc(row.description)}</td><td>${esc(row.cashAccount || '-')}</td><td>${esc(row.incomeAccount || '-')}</td></tr>`).join('')
      : emptyRow(5);

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
      ${drawer.closingNote ? `<div class="drawer-report-note"><b>Keterangan Pulang:</b> ${esc(drawer.closingNote)}</div>` : ''}

      ${section('1. PENJUALAN BAYAR TUNAI', salesTable(sections.cashSales || [], totals.cashSales, totals.cashSalesItems))}
      ${section('2. PROMOSI', `${table(['NAMA', 'JUMLAH', 'TOTAL'], promoRows)}<div class="drawer-report-total">Total <b>${rupiah(totals.promotions)}</b></div>`)}
      ${section('3A. BELANJA BAHAN BAYAR TUNAI', purchaseTable(sections.cashPurchases || [], totals.cashPurchases))}
      ${section('4.1 OPERASIONAL KAS', expenseTable(sections.cashExpenses || [], totals.cashExpenses))}
      ${section('4.2 OPERASIONAL NON KAS', expenseTable(sections.nonCashExpenses || [], totals.nonCashExpenses))}
      ${section('5. MASAK', table(['HASIL', 'BAHAN BAKU'], cookingRows))}
      ${section('6. STOK SISA', table(['PRODUK', 'STOK AWAL', 'STOK AKHIR'], stockRows))}

      ${section('PERHITUNGAN', table(['Keterangan', 'Total'], `
        <tr><td>Penjualan Tunai (Plus)</td><td>${rupiah(totals.cashSales)}</td></tr>
        <tr><td>Promosi (Minus)</td><td>${rupiah(totals.promotions)}</td></tr>
        <tr><td>Pendapatan Riil Tunai</td><td>${rupiah(totals.realCashRevenue)}</td></tr>
        <tr><td>Modal</td><td>${rupiah(drawer.openingAmount)}</td></tr>
        <tr><td>Belanja Bahan Tunai (Minus)</td><td>${rupiah(totals.cashPurchases)}</td></tr>
        <tr><td>Operasional Kas (Minus)</td><td>${rupiah(totals.cashExpenses)}</td></tr>
        <tr><td>Kas Masuk (Plus)</td><td>${rupiah(totals.cashIn)}</td></tr>
        <tr><td>Ekspektasi Di Laci</td><td><b>${rupiah(totals.expectedCash)}</b></td></tr>
        <tr><td>Saldo Pulang</td><td>${drawer.closingAmount == null ? '-' : rupiah(drawer.closingAmount)}</td></tr>
        <tr><td>Selisih Kas</td><td>${totals.cashDifference == null ? '-' : rupiah(totals.cashDifference)}</td></tr>`))}

      <div class="drawer-report-divider">CATATAN TAMBAHAN</div>
      ${section('1B. PENJUALAN BAYAR NON TUNAI', salesTable(sections.nonCashSales || [], totals.nonCashSales, totals.nonCashSalesItems))}
      ${section('3B. BELANJA BAHAN BAYAR NON TUNAI', purchaseTable(sections.nonCashPurchases || [], totals.nonCashPurchases))}
      ${section('PENYESUAIAN STOK', table(['PRODUK', 'Stok Tercatat', 'Stok Riil', 'Selisih'], adjustmentRows))}
      ${section('KAS MASUK', table(['Tanggal', 'Jumlah', 'Keterangan', 'Akun Kas', 'Akun Pendapatan'], cashInRows))}
    </div>`;
  }

  window.MAXIDrawerReport = { render };
})();
