// js/config.js (PERBAIKAN)
// Pastikan script supabase-js sudah di-load di HTML sebelum file ini.
// Contoh load di HTML head: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

(function () {
  // GANTI DENGAN KREDENSIAL SUPABASE ANDA
  const SUPABASE_URL = 'https://itwzqlqityefmyqdjuzm.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0d3pxbHFpdHllZm15cWRqdXptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjcwNTUsImV4cCI6MjA4NjMwMzA1NX0.02RaZZeMof0N3wdk-jj_cxxm6z2DBhEE2YoKuG0BaDw';

  // Safety: cek apakah library supabase sudah tersedia
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase JS tidak ditemukan. Pastikan script CDN Supabase di-load sebelum js/config.js.');
    // expose placeholders supaya script lain tidak crash (tapi akan tetap nggak berfungsi)
    window._db = null;
    // fallback formatRupiah
    window.formatRupiah = window.formatRupiah || function (n) { return 'Rp ' + (Number(n||0)).toLocaleString('id-ID'); };
    return;
  }

  // Create client dan expose ke global
  try {
    const { createClient } = window.supabase;
    window._db = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    console.error('Gagal inisialisasi Supabase client:', err);
    window._db = null;
  }

  // Helper format rupiah (expose ke global)
  window.formatRupiah = window.formatRupiah || function (number) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(Number(number || 0));
  };

  // Optional: online/offline notif jika Toast tersedia
  window.addEventListener('online', () => {
    if (window.Toast && typeof window.Toast.fire === 'function') {
      Toast.fire('Internet Kembali!', '', 'success');
    } else {
      console.info('Online');
    }
  });
  window.addEventListener('offline', () => {
    if (window.Toast && typeof window.Toast.fire === 'function') {
      Toast.fire('Mode Offline', 'Data akan disimpan lokal dulu', 'warning');
    } else {
      console.warn('Offline');
    }
  });

})();
