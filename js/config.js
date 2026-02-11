// Load Supabase dari CDN
// Pastikan script supabase-js sudah di-load di HTML sebelum file ini
const { createClient } = supabase;

// GANTI DENGAN KREDENSIAL SUPABASE ANDA
const SUPABASE_URL = 'https://itwzqlqityefmyqdjuzm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0d3pxbHFpdHllZm15cWRqdXptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjcwNTUsImV4cCI6MjA4NjMwMzA1NX0.02RaZZeMof0N3wdk-jj_cxxm6z2DBhEE2YoKuG0BaDw';

const _db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper untuk format Rupiah
const formatRupiah = (number) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(number);
};

// Cek status Online/Offline untuk UI
window.addEventListener('online', () => Toast.fire('Internet Kembali!', '', 'success'));
window.addEventListener('offline', () => Toast.fire('Mode Offline', 'Data akan disimpan lokal dulu', 'warning'));