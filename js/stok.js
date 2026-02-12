// js/stok.js
// Mengasumsikan js/config.js sudah di-load sebelumnya dan menyediakan:
// - window._db (Supabase client)
// - formatRupiah(value) optionally
// Jika tidak ada formatRupiah, skrip ini pakai fallback sederhana.

(() => {
  // fallback format
  const formatMoney = (v) => (typeof formatRupiah === 'function' ? formatRupiah(v) : ('Rp ' + Number(v || 0).toLocaleString('id-ID')) );
  const $ = (id) => document.getElementById(id);

  let products = []; // semua produk dari DB
  let filtered = []; // hasil filter/search/sort
  let categories = new Set();

  const searchInput = $('searchInput');
  const categoryFilter = $('categoryFilter');
  const sortSelect = $('sortSelect');
  const productsTbody = $('productsTbody');
  const exportVisibleBtn = $('exportVisibleBtn');
  const refreshBtn = $('refreshBtn');
  const backBtn = $('backBtn');
  const summaryStats = $('summaryStats');

  // helper status
  function statusForStock(stock) {
    const s = Number(stock || 0);
    if (s <= 0) return { key: 'habis', label: 'Habis', class: 'status-habis' };
    if (s <= 10) return { key: 'menipis', label: 'Menipis', class: 'status-menipis' };
    return { key: 'aman', label: 'Aman', class: 'status-aman' };
  }

  // render rows
  function renderTable(list) {
    productsTbody.innerHTML = '';
    if (!list || list.length === 0) {
      productsTbody.innerHTML = `<tr><td colspan="7" class="px-4 py-6 text-center muted">Produk tidak ditemukan.</td></tr>`;
      summaryStats.innerText = '0 produk ditampilkan';
      return;
    }

    const rows = list.map((p, i) => {
      const st = statusForStock(p.stock);
      return `
        <tr class="${st.key === 'habis' ? 'bg-red-50' : ''}">
          <td class="px-4 py-3 align-top">${i+1}</td>
          <td class="px-4 py-3 align-top font-medium">${escapeHtml(p.name || '-')}</td>
          <td class="px-4 py-3 align-top">${escapeHtml(p.category || '-')}</td>
          <td class="px-4 py-3 align-top text-right">${formatMoney(p.price)}</td>
          <td class="px-4 py-3 align-top text-center">${p.stock == null ? '-' : p.stock}</td>
          <td class="px-4 py-3 align-top text-center"><span class="badge ${st.class}">${st.label}</span></td>
          <td class="px-4 py-3 align-top text-right">
            <button class="export-single small-btn bg-gray-100 px-2 py-1 rounded" data-id="${p.id}">Export</button>
          </td>
        </tr>
      `;
    }).join('');
    productsTbody.innerHTML = rows;

    // attach per-row export
    productsTbody.querySelectorAll('.export-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.id;
        const prod = list.find(x => x.id === id);
        if (prod) exportProductCSV(prod);
      });
    });

    summaryStats.innerText = `${list.length} produk ditampilkan (total produk: ${products.length})`;
  }

  // escape simple html
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  }

  // filtering + search + sort
  function applyFilters() {
    const q = (searchInput.value || '').toLowerCase().trim();
    const cat = categoryFilter.value;
    const sort = sortSelect.value;

    filtered = products.filter(p => {
      let ok = true;
      if (cat) ok = ok && (p.category === cat);
      if (q) {
        const hay = (p.name || '') + ' ' + (p.category || '');
        ok = ok && hay.toLowerCase().includes(q);
      }
      return ok;
    });

    // sorting
    switch (sort) {
      case 'name_asc':
        filtered.sort((a,b) => (a.name||'').localeCompare(b.name||''));
        break;
      case 'stock_asc':
        filtered.sort((a,b) => Number(a.stock||0) - Number(b.stock||0));
        break;
      case 'stock_desc':
        filtered.sort((a,b) => Number(b.stock||0) - Number(a.stock||0));
        break;
      case 'price_asc':
        filtered.sort((a,b) => Number(a.price||0) - Number(b.price||0));
        break;
      case 'price_desc':
        filtered.sort((a,b) => Number(b.price||0) - Number(a.price||0));
        break;
    }

    renderTable(filtered);
  }

  // export visible to CSV
  function exportVisibleCSV() {
    if (!filtered || filtered.length === 0) { alert('Tidak ada data untuk diekspor'); return; }
    const headers = ['ID','Nama','Kategori','Harga','Stok'];
    const rows = filtered.map(p => [p.id, p.name || '', p.category || '', p.price || 0, p.stock == null ? '' : p.stock]);
    downloadCSV([headers, ...rows], `stok_produk_${new Date().toISOString().slice(0,10)}.csv`);
  }

  // export single product CSV
  function exportProductCSV(prod) {
    const headers = ['Field','Value'];
    const rows = [
      ['ID', prod.id],
      ['Nama', prod.name || ''],
      ['Kategori', prod.category || ''],
      ['Harga', prod.price || 0],
      ['Stok', prod.stock == null ? '' : prod.stock]
    ];
    downloadCSV([headers, ...rows], `produk_${(prod.name||'produk').replace(/\s+/g,'_')}.csv`);
  }

  // helper download CSV
  function downloadCSV(rowsArray, filename) {
    const csv = rowsArray.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // fetch products from supabase
  async function fetchProducts() {
    productsTbody.innerHTML = `<tr><td colspan="7" class="px-4 py-6 text-center muted">Memuat produk…</td></tr>`;
    try {
      if (!window._db) throw new Error('_db (Supabase client) tidak ditemukan. Pastikan js/config.js di-load.');
      const { data, error } = await _db.from('products').select('id,name,category,price,stock,updated_at').order('name', { ascending: true });
      if (error) throw error;
      products = (data || []).map(p => ({ id: p.id, name: p.name, category: p.category, price: Number(p.price||0), stock: p.stock, updated_at: p.updated_at }));
      // build categories
      categories = new Set(products.map(p => p.category).filter(Boolean));
      renderCategoryOptions();
      applyFilters();
    } catch (err) {
      console.error('fetchProducts err', err);
      productsTbody.innerHTML = `<tr><td colspan="7" class="px-4 py-6 text-center text-red-500">Gagal memuat produk. Cek koneksi / konfigurasi.</td></tr>`;
    }
  }

  function renderCategoryOptions() {
    categoryFilter.innerHTML = `<option value="">Semua Kategori</option>`;
    Array.from(categories).sort().forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      categoryFilter.appendChild(opt);
    });
  }

  // debounce helper
  function debounce(fn, ms=250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // events
  searchInput.addEventListener('input', debounce(applyFilters, 300));
  categoryFilter.addEventListener('change', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  exportVisibleBtn.addEventListener('click', exportVisibleCSV);
  refreshBtn.addEventListener('click', fetchProducts);
  backBtn.addEventListener('click', () => window.location.href = 'owner.html');

  // initial load
  fetchProducts();

})();
