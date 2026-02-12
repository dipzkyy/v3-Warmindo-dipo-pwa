// js/owner.js
// Mengasumsikan js/config.js telah dijalankan sebelumnya dan:
// - window._db adalah Supabase client
// - formatRupiah(...) tersedia global
// Jika tidak, cek config.js terlebih dahulu.

/////////////////////// Utils ///////////////////////
function shortId(id) { if (!id) return ''; return id.slice(0,8) + '...' + id.slice(-4); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

/////////////////////// State ///////////////////////
let transactionsCache = []; // array transaksi untuk rentang aktif
let itemsByTransaction = new Map(); // Map<transaction_id, [items]>
let cashierSet = new Set();
let productStats = {}; // {name: {qty,total}}
let salesChart = null, categoryChart = null;
const ITEM_MEAL_CUT = 10000; // config potong makan

/////////////////////// Initial checks ///////////////////////
if (!window._db) console.warn('Warning: _db (Supabase client) tidak ditemukan. Pastikan js/config.js di-load sebelum js/owner.js');
if (typeof formatRupiah !== 'function') console.warn('Warning: formatRupiah() tidak ditemukan. Pastikan js/config.js mendefinisikannya.');

const user = JSON.parse(localStorage.getItem('dipo_user'));
if (!user || user.role !== 'owner') {
    window.location.href = 'index.html';
}

document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'index.html';
});

// tombol cek stok -> arahkan ke stok.html
document.getElementById('btnStok').addEventListener('click', () => {
    window.location.href = 'stok.html';
});

/////////////////////// Init date inputs ///////////////////////
document.getElementById('currentDateDisplay').innerText = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const now = new Date();
const start = new Date(); start.setDate(now.getDate() - 30);
document.getElementById('startDate').valueAsDate = start;
document.getElementById('endDate').valueAsDate = now;

/////////////////////// Events ///////////////////////
document.getElementById('btnUpdate').addEventListener('click', () => fetchData());
document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
document.getElementById('exportPdfBtn').addEventListener('click', exportPDF);

let searchTimer = null;
document.getElementById('searchTrans').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTransactionsListFiltered, 300);
});
document.getElementById('filterCashier').addEventListener('change', renderTransactionsListFiltered);

/////////////////////// Core: Fetch Data (with product stock enrichment) ///////////////////////
async function fetchData() {
    const dateStart = document.getElementById('startDate').value;
    const dateEnd = document.getElementById('endDate').value;

    // reset caches/UI
    itemsByTransaction.clear();
    transactionsCache = [];
    productStats = {};
    cashierSet.clear();
    document.getElementById('transactionsList').innerHTML = '<div class="p-6 text-sm text-gray-500">Memuat transaksi...</div>';

    try {
        // 1) Ambil transaksi ringkas
        const { data: trxs, error: trErr } = await _db.from('transactions')
            .select('id,tanggal,waktu,total_gross,cashier_id')
            .gte('tanggal', dateStart)
            .lte('tanggal', dateEnd)
            .eq('is_expense', false)
            .order('tanggal', { ascending: false });

        if (trErr) throw trErr;
        transactionsCache = trxs || [];
        transactionsCache.forEach(t => { if (t.cashier_id) cashierSet.add(t.cashier_id); });
        renderCashierFilter();

        // 2) Ambil items untuk transaksi-transaksi tersebut (eager) -> lalu enrich dari products table
        const trxIds = transactionsCache.map(t => t.id);
        let items = [];
        if (trxIds.length > 0) {
            const { data: itData, error: itErr } = await _db.from('transaction_items')
                .select('id,transaction_id,product_id,qty,price_at_time')
                .in('transaction_id', trxIds);
            if (itErr) throw itErr;
            items = itData || [];
        }

        // 3) Ambil product info (name, stock) berdasarkan product_id pada items
        const productIds = Array.from(new Set(items.map(i => i.product_id).filter(Boolean)));
        let productMap = new Map();
        if (productIds.length > 0) {
            const { data: prods, error: prodErr } = await _db.from('products')
                .select('id,name,stock')
                .in('id', productIds);
            if (prodErr) {
                console.warn('Tidak berhasil ambil products:', prodErr);
            } else {
                (prods || []).forEach(p => productMap.set(p.id, { id: p.id, name: p.name, stock: p.stock }));
            }
        }

        // 4) attach product info into items
        items.forEach(it => {
            it.products = productMap.get(it.product_id) || null;
        });

        // 5) Ambil expenses
        const { data: exps = [], error: expErr } = await _db.from('expenses').select('*').gte('tanggal', dateStart).lte('tanggal', dateEnd);
        if (expErr) throw expErr;

        // 6) Group items by transaction and compute productStats
        itemsByTransaction = new Map();
        items.forEach(it => {
            const tid = it.transaction_id;
            if (!itemsByTransaction.has(tid)) itemsByTransaction.set(tid, []);
            itemsByTransaction.get(tid).push(it);

            const pname = it.products?.name || 'Menu Tak Dikenal';
            if (!productStats[pname]) productStats[pname] = { qty: 0, total: 0 };
            productStats[pname].qty += Number(it.qty || 0);
            productStats[pname].total += Number(it.price_at_time || 0) * Number(it.qty || 0);
        });

        // 7) Process UI
        processUI(transactionsCache, items, exps);

    } catch (err) {
        console.error('Fetch Error:', err);
        alert('Gagal memuat data. Cek koneksi internet dan konfigurasi Supabase.');
        document.getElementById('transactionsList').innerHTML = '<div class="p-6 text-sm text-red-500">Gagal memuat transaksi.</div>';
    }
}

/////////////////////// Process & Render UI ///////////////////////
function processUI(trxs, items, exps) {
    // Build daily report map
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    const reportMap = {};
    let curr = new Date(startDate);
    while (curr <= endDate) {
        const ds = curr.toISOString().split('T')[0];
        reportMap[ds] = { date: ds, dayName: curr.toLocaleDateString('id-ID', { weekday: 'long' }), income:0, expense:0, count:0, notes:[] };
        curr.setDate(curr.getDate() + 1);
    }

    trxs.forEach(t => {
        if (reportMap[t.tanggal]) {
            reportMap[t.tanggal].income += Number(t.total_gross || 0);
            reportMap[t.tanggal].count++;
        }
    });

    (exps||[]).forEach(e => {
        const ds = e.tanggal;
        if (reportMap[ds]) {
            const nominal = Number(e.nominal || e.amount || 0);
            reportMap[ds].expense += nominal;
            if (e.note) reportMap[ds].notes.push(`${e.note} (${formatRupiah(nominal)})`);
            else if (e.item_name) reportMap[ds].notes.push(`${e.item_name} (${formatRupiah(nominal)})`);
        }
    });

    Object.values(reportMap).forEach(r => {
        const day = new Date(r.date).getDay();
        if (r.income > 0 && day !== 0) {
            r.expense += ITEM_MEAL_CUT;
            r.notes.push("Potongan Makan (10k)");
        }
    });

    // Laporan Kolektif
    const sortedDates = Object.keys(reportMap).sort().reverse();
    let htmlMain = "";
    let totalIn = 0, totalOut = 0, totalTrx = 0;
    sortedDates.forEach(d => {
        const r = reportMap[d];
        const net = r.income - r.expense;
        totalIn += r.income; totalOut += r.expense; totalTrx += r.count;

        htmlMain += `
        <tr class="hover:bg-gray-50 transition border-b">
            <td class="px-6 py-4">
                <div class="font-bold">${r.dayName}</div>
                <div class="text-[10px] text-gray-400 font-mono uppercase">${r.date}</div>
            </td>
            <td class="px-6 py-4 text-right font-bold text-blue-600">${formatRupiah(r.income)}</td>
            <td class="px-6 py-4 text-right font-bold text-orange-600">-${formatRupiah(r.expense)}</td>
            <td class="px-6 py-4 text-right font-black ${net >= 0 ? 'text-green-600' : 'text-red-600'}">${formatRupiah(net)}</td>
            <td class="px-6 py-4 text-[10px] text-gray-500 italic max-w-xs truncate">${r.notes.join('; ')}</td>
        </tr>`;
    });
    document.getElementById('reportTableBody').innerHTML = htmlMain;

    // Cards
    document.getElementById('valGross').innerText = formatRupiah(totalIn);
    document.getElementById('valExpense').innerText = formatRupiah(totalOut);
    document.getElementById('valNet').innerText = formatRupiah(totalIn - totalOut);
    document.getElementById('valCount').innerText = totalTrx;

    // Produk terlaris
    document.getElementById('productTableBody').innerHTML = Object.entries(productStats)
        .sort((a,b) => b[1].qty - a[1].qty)
        .map(([name, s]) => `<tr><td class="px-4 py-3 font-medium">${name}</td><td class="px-4 py-3 text-center"><span class="bg-gray-100 px-2 py-1 rounded font-bold">${s.qty}</span></td><td class="px-4 py-3 text-right text-gray-400">${formatRupiah(s.total)}</td></tr>`).join('');

    // Expenses table
    document.getElementById('expenseTableBody').innerHTML = (exps||[]).sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal)).map(e => `<tr><td class="px-4 py-3 text-gray-400">${e.tanggal.split('-')[2]}/${e.tanggal.split('-')[1]}</td><td class="px-4 py-3">${e.note || e.item_name}</td><td class="px-4 py-3 text-right text-red-500 font-bold">-${formatRupiah(e.nominal || e.amount)}</td></tr>`).join('');

    // Charts
    updateCharts(reportMap, totalIn, totalOut);

    // Transactions list
    renderTransactionsList();
}

/////////////////////// Render cashier filter ///////////////////////
function renderCashierFilter() {
    const sel = document.getElementById('filterCashier');
    const current = sel.value;
    sel.innerHTML = '<option value="">Semua Kasir</option>';
    Array.from(cashierSet).forEach(c => {
        sel.insertAdjacentHTML('beforeend', `<option value="${c}">${c}</option>`);
    });
    sel.value = current;
}

/////////////////////// Render Transactions List ///////////////////////
function renderTransactionsList() {
    const container = document.getElementById('transactionsList');
    if (!transactionsCache || transactionsCache.length === 0) {
        container.innerHTML = '<div class="p-6 text-sm text-gray-500">Tidak ada transaksi pada rentang tanggal ini.</div>';
        return;
    }

    const html = transactionsCache.map(t => {
        return `
        <div class="trx-row" id="trx-${t.id}" data-id="${t.id}">
            <button class="expand-btn small-btn border" data-id="${t.id}" aria-expanded="false" title="Tampilkan detail transaksi">
                <i class="ri-arrow-down-s-line"></i>
            </button>
            <div class="trx-meta">
                <div class="text-sm">
                    <div class="font-bold">${t.tanggal.split('-')[2]}/${t.tanggal.split('-')[1]}</div>
                    <div class="text-[11px] text-gray-400">${t.waktu}</div>
                </div>
                <div class="text-xs text-gray-500">ID: ${shortId(t.id)}</div>
                <div class="text-xs text-gray-500">Kasir: ${t.cashier_id || '-'}</div>
                <div class="ml-auto font-bold text-right">${formatRupiah(t.total_gross)}</div>
            </div>
        </div>
        <div class="trx-detail hidden" id="trx-detail-${t.id}">
            <div class="p-2 text-sm text-gray-400">Klik untuk melihat detail...</div>
        </div>
        `;
    }).join('');

    container.innerHTML = html;
    container.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            const id = btn.dataset.id;
            await toggleTransactionDetail(id, btn);
        });
    });
}

/////////////////////// Render filtered list (search / cashier) ///////////////////////
function renderTransactionsListFiltered() {
    const q = (document.getElementById('searchTrans').value || '').toLowerCase();
    const cashier = document.getElementById('filterCashier').value;
    const filtered = transactionsCache.filter(t => {
        let match = true;
        if (cashier) match = match && (t.cashier_id === cashier);
        if (q) {
            const inMeta = (t.id || '').toLowerCase().includes(q) || (t.cashier_id || '').toLowerCase().includes(q);
            const itemMatch = (itemsByTransaction.get(t.id) || []).some(it => (it.products?.name || '').toLowerCase().includes(q));
            match = match && (inMeta || itemMatch);
        }
        return match;
    });

    const container = document.getElementById('transactionsList');
    if (!filtered || filtered.length === 0) {
        container.innerHTML = '<div class="p-6 text-sm text-gray-500">Tidak ada transaksi sesuai filter/pencarian.</div>';
        return;
    }

    const html = filtered.map(t => {
        return `
        <div class="trx-row" id="trx-${t.id}" data-id="${t.id}">
            <button class="expand-btn small-btn border" data-id="${t.id}" aria-expanded="false" title="Tampilkan detail transaksi">
                <i class="ri-arrow-down-s-line"></i>
            </button>
            <div class="trx-meta">
                <div class="text-sm">
                    <div class="font-bold">${t.tanggal.split('-')[2]}/${t.tanggal.split('-')[1]}</div>
                    <div class="text-[11px] text-gray-400">${t.waktu}</div>
                </div>
                <div class="text-xs text-gray-500">ID: ${shortId(t.id)}</div>
                <div class="text-xs text-gray-500">Kasir: ${t.cashier_id || '-'}</div>
                <div class="ml-auto font-bold text-right">${formatRupiah(t.total_gross)}</div>
            </div>
        </div>
        <div class="trx-detail hidden" id="trx-detail-${t.id}">
            <div class="p-2 text-sm text-gray-400">Klik untuk melihat detail...</div>
        </div>
        `;
    }).join('');

    container.innerHTML = html;
    container.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            const id = btn.dataset.id;
            await toggleTransactionDetail(id, btn);
        });
    });
}

/////////////////////// Toggle & Render Detail for a Transaction ///////////////////////
async function toggleTransactionDetail(transactionId, btnEl) {
    const detailEl = document.getElementById(`trx-detail-${transactionId}`);
    const expanded = btnEl.getAttribute('aria-expanded') === 'true';
    if (expanded) {
        btnEl.setAttribute('aria-expanded', 'false');
        detailEl.classList.add('hidden');
        btnEl.querySelector('i').className = 'ri-arrow-down-s-line';
        return;
    }

    btnEl.setAttribute('aria-expanded', 'true');
    detailEl.classList.remove('hidden');
    btnEl.querySelector('i').className = 'ri-loader-4-line ri-spin';

    // cached
    if (itemsByTransaction.has(transactionId)) {
        renderTransactionItemsInto(transactionId, detailEl, itemsByTransaction.get(transactionId));
        btnEl.querySelector('i').className = 'ri-arrow-up-s-line';
        return;
    }

    // fetch items for that transaction
    try {
        const { data: items = [], error } = await _db.from('transaction_items')
            .select('id,transaction_id,product_id,qty,price_at_time')
            .eq('transaction_id', transactionId);
        if (error) throw error;

        // enrich products from products table if product_id present
        const prodIds = Array.from(new Set(items.map(i => i.product_id).filter(Boolean)));
        let productMap = new Map();
        if (prodIds.length > 0) {
            const { data: prods = [], error: pErr } = await _db.from('products').select('id,name,stock').in('id', prodIds);
            if (!pErr) prods.forEach(p => productMap.set(p.id, { id: p.id, name: p.name, stock: p.stock }));
        }
        items.forEach(it => { it.products = productMap.get(it.product_id) || null; });

        itemsByTransaction.set(transactionId, items);
        renderTransactionItemsInto(transactionId, detailEl, items);
        btnEl.querySelector('i').className = 'ri-arrow-up-s-line';
    } catch (err) {
        console.error('Fetch items err:', err);
        detailEl.innerHTML = `<div class="p-3 text-sm text-red-500">Gagal memuat detail transaksi.</div>`;
        btnEl.querySelector('i').className = 'ri-arrow-down-s-line';
    }
}

function renderTransactionItemsInto(transactionId, detailEl, items) {
    if (!items || items.length === 0) {
        detailEl.innerHTML = `<div class="p-3 text-sm text-gray-500">Tidak ada item pada transaksi ini.</div>`;
        return;
    }

    const rows = items.map((it, idx) => {
        const name = it.products?.name || 'Menu Tak Dikenal';
        const stock = (typeof it.products?.stock !== 'undefined' && it.products?.stock !== null) ? it.products.stock : '-';
        const qty = Number(it.qty || 0);
        const price = Number(it.price_at_time || 0);
        const subtotal = qty * price;
        return `<tr>
            <td class="px-4 py-2 text-xs">${idx+1}</td>
            <td class="px-4 py-2 text-xs font-medium">${name}</td>
            <td class="px-4 py-2 text-center text-xs">${qty}</td>
            <td class="px-4 py-2 text-right text-xs">${formatRupiah(price)}</td>
            <td class="px-4 py-2 text-right text-xs">${formatRupiah(subtotal)}</td>
            <td class="px-4 py-2 text-center text-xs">${stock}</td>
        </tr>`;
    }).join('');

    const total = items.reduce((s,it) => s + (Number(it.qty||0) * Number(it.price_at_time||0)), 0);

    detailEl.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <div class="text-sm font-bold">Detail Produk</div>
            <div>
                <button class="small-btn bg-gray-100" onclick="exportTransactionToCSV('${transactionId}')">Export CSV</button>
            </div>
        </div>
        <div class="overflow-auto">
        <table class="w-full text-xs text-left">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2">#</th>
                    <th class="px-4 py-2">Produk</th>
                    <th class="px-4 py-2 text-center">Qty</th>
                    <th class="px-4 py-2 text-right">Harga</th>
                    <th class="px-4 py-2 text-right">Subtotal</th>
                    <th class="px-4 py-2 text-center">Stok</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
            <tfoot>
                <tr class="border-t">
                    <td colspan="4" class="px-4 py-2 font-bold">Total</td>
                    <td class="px-4 py-2 text-right font-bold">${formatRupiah(total)}</td>
                    <td class="px-4 py-2"></td>
                </tr>
            </tfoot>
        </table>
        </div>
    `;
}

/////////////////////// Export single transaction CSV ///////////////////////
function exportTransactionToCSV(transactionId) {
    const items = itemsByTransaction.get(transactionId) || [];
    if (!items || items.length === 0) { alert('Tidak ada item untuk diekspor'); return; }

    const headers = ['No','Produk','Qty','Harga','Subtotal','Stok'];
    const rows = items.map((it, idx) => {
        const name = it.products?.name || 'Menu Tak Dikenal';
        const stock = (typeof it.products?.stock !== 'undefined' && it.products?.stock !== null) ? it.products.stock : '';
        const qty = Number(it.qty||0);
        const price = Number(it.price_at_time||0);
        const subtotal = qty * price;
        return [idx+1, name, qty, price, subtotal, stock];
    });

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transaksi_${transactionId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/////////////////////// Charts ///////////////////////
function updateCharts(map, tin, tout) {
    const dataArr = Object.values(map).sort((a,b) => new Date(a.date) - new Date(b.date));
    if (salesChart) salesChart.destroy();
    salesChart = new Chart(document.getElementById('salesChart'), {
        type: 'line',
        data: {
            labels: dataArr.map(i => i.date.split('-')[2] + '/' + i.date.split('-')[1]),
            datasets: [{ label: 'Laba Bersih', data: dataArr.map(i => i.income - i.expense), borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(document.getElementById('categoryChart'), {
        type: 'doughnut',
        data: {
            labels: ['Masuk', 'Keluar'],
            datasets: [{ data: [tin, tout], backgroundColor: ['#3b82f6', '#f97316'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%' }
    });
}

/////////////////////// Export Excel & PDF ///////////////////////
function exportExcel() {
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.table_to_sheet(document.getElementById('exportTable'));
    XLSX.utils.book_append_sheet(wb, ws1, "Laporan Harian");

    const ws2 = XLSX.utils.table_to_sheet(document.getElementById('tableExpense'));
    XLSX.utils.book_append_sheet(wb, ws2, "Rincian Belanja");

    const ws3 = XLSX.utils.table_to_sheet(document.getElementById('tableProduct'));
    XLSX.utils.book_append_sheet(wb, ws3, "Menu Terjual");

    XLSX.writeFile(wb, `Laporan_Owner_${document.getElementById('startDate').value}.xlsx`);
}

function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.text("Laporan Keuangan - Warmindo Diponegoro", 14, 15);
    doc.setFontSize(10);
    doc.text(`Periode: ${document.getElementById('startDate').value} s/d ${document.getElementById('endDate').value}`, 14, 22);
    doc.autoTable({ html: '#exportTable', startY: 30, theme: 'grid', styles: { fontSize: 8 } });
    doc.save("Laporan_Dipo.pdf");
}

/////////////////////// Initial load ///////////////////////
fetchData();
