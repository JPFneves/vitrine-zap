// ════════════════════════════════════════════════════════════════════
// Configuração do Vitrine Zap
//
// Com as duas chaves do Supabase em branco, o app roda em "modo demonstração":
// tudo fica guardado no navegador (IndexedDB).
//
// Preenchidas, as lojas, os produtos e os pedidos vão pro Supabase: o link e o
// QR code da loja abrem em qualquer celular, o lojista entra com o e-mail e a
// senha que você criou pra ele e o pedido aparece no painel na hora.
// Passo a passo no README.md.
//
// Onde achar: Supabase → Project Settings → API Keys (ou Data API)
//   SUPABASE_URL   → "Project URL", tipo https://abcdefgh.supabase.co
//   SUPABASE_CHAVE → a chave "anon public" (ou a "publishable")
// Essas duas podem ficar no código do site: quem protege os dados são as regras
// do supabase/schema.sql. NUNCA ponha aqui a chave "service_role" (secreta).
// ════════════════════════════════════════════════════════════════════

export const SUPABASE_URL = 'https://nwvxfmnturkldbmsboqa.supabase.co';
export const SUPABASE_CHAVE = 'sb_publishable_EBWjJruJXua3cwyKCX8cAA_MHWaAbkL';

// Seu WhatsApp com DDD (o 55 do Brasil entra sozinho, ex.: 35999991234). É pra onde vai quem clica em
// "Quero minha loja" e quem esqueceu a senha. Em branco, esses botões abrem o site da Neves Tecnologia.
export const CONTATO_WHATSAPP = '35997004425';

// Endereço do código no GitHub, pro link do rodapé da página inicial (em branco, o link some)
export const REPOSITORIO = '';
