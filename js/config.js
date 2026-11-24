// Заполните после создания проекта Supabase.
// anon key предназначен для публичного клиента; секретный service_role key сюда добавлять нельзя.
window.CATWAR_CONFIG = {
  SUPABASE_URL: "ВСТАВЬТЕ_PROJECT_URL",
  SUPABASE_ANON_KEY: "ВСТАВЬТЕ_ANON_PUBLIC_KEY",
  PROFILE_BASE_URL: "https://catwar.su/cat/"
};
window.catwarSupabase = null;
if (window.CATWAR_CONFIG.SUPABASE_URL.startsWith("https://") &&
    !window.CATWAR_CONFIG.SUPABASE_ANON_KEY.startsWith("ВСТАВЬТЕ")) {
  window.catwarSupabase = window.supabase.createClient(
    window.CATWAR_CONFIG.SUPABASE_URL,
    window.CATWAR_CONFIG.SUPABASE_ANON_KEY
  );
}
