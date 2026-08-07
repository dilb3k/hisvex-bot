import { env } from "../config/env";
import type { PlanDuration, PlanTier } from "../services/api-client";

export const TIER_LABEL: Record<PlanTier, string> = {
  bor: "Bor",
  pro: "Pro",
};

export const DURATION_LABEL: Record<PlanDuration, string> = {
  1: "1 oy",
  6: "6 oy (−6%)",
  12: "12 oy (−12%)",
};

export function formatSom(amount: number): string {
  return `${amount.toLocaleString("uz-UZ").replace(/,/g, " ")} so'm`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "long", year: "numeric" });
}

export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export const texts = {
  welcome:
    "🍸 <b>Hisvex botiga xush kelibsiz!</b>\n\n" +
    "Bu bot orqali obunangizni sotib olish, uzaytirish va to'lov holatini kuzatib borishingiz mumkin.\n\n" +
    "Davom etish uchun telefon raqamingizni yuboring — u Hisvex hisobingizga bog'lanadi.",
  requestPhoneButton: "📱 Telefon raqamni yuborish",
  userNotFound: (phone: string) =>
    `❗️ ${phone} raqami bilan ro'yxatdan o'tgan Hisvex hisobi topilmadi.\n\n` +
    `Avval ilovada ro'yxatdan o'ting, so'ng shu tugmani qayta bosing.`,
  retryButton: "🔄 Qayta urinish",
  openAppButton: "📲 Ilovani ochish",
  linked: (username: string) => `✅ Hisobingiz bog'landi: <b>${username}</b>`,
  mainMenu: "Quyidagilardan birini tanlang:",
  menuButtons: {
    buySubscription: "💳 Obuna sotib olish / uzaytirish",
    myAccount: "📊 Mening hisobim",
    myPayments: "🧾 To'lovlarim",
    help: "🆘 Yordam",
    admin: "🛠 Admin panel",
  },
  myAccount: (username: string, tier: string, endDate: string, left: number | null) => {
    const tierLine =
      tier === "tekin"
        ? "Tarif: <b>Tekin</b>"
        : `Tarif: <b>${tier === "pro" ? "Pro" : "Bor"}</b>\nAmal qilish muddati: <b>${endDate}</b>` +
          (left !== null ? `\nQoldi: <b>${left} kun</b>` : "");
    return `📊 <b>${username}</b>\n\n${tierLine}`;
  },
  choosePlan: "Qaysi tarifni tanlaysiz?",
  chooseDuration: (tier: PlanTier) => `<b>${TIER_LABEL[tier]}</b> tarifi — muddatni tanlang:`,
  planFeatures: (features: string[]) => features.map((f) => `✓ ${f}`).join("\n"),
  chooseMethod: (tier: PlanTier, duration: PlanDuration, amount: string) =>
    `<b>${TIER_LABEL[tier]}</b> — ${DURATION_LABEL[duration]}\n💰 Narxi: <b>${amount}</b>\n\nTo'lov usulini tanlang:`,
  methodClick: "⚡️ Click orqali (avtomatik)",
  methodManual: "💳 Karta orqali (admin tasdiqlaydi)",
  clickNotReady: "Click orqali to'lov hozircha sozlanmagan. Iltimos, karta orqali to'lang.",
  clickPayButton: "💳 Click orqali to'lash",
  manualCardInstructions: (amount: string) =>
    `💳 <b>Karta orqali to'lov</b>\n\n` +
    `Quyidagi kartaga <b>${amount}</b> o'tkazing:\n\n` +
    `<code>${env.CARD_NUMBER}</code>\n` +
    `${env.CARD_HOLDER_NAME}\n\n` +
    `To'lovni amalga oshirgach, chek/skrinshotni shu yerga rasm qilib yuboring. ` +
    `Admin tasdiqlagach, obunangiz avtomatik faollashadi.`,
  manualReceiptReceived:
    "✅ Chek qabul qilindi va admin ko'rib chiqishga yuborildi.\n\n" +
    "Odatda bir necha daqiqa ichida tasdiqlanadi. Tasdiqlangach sizga xabar beramiz.",
  paymentApprovedUser: (tier: PlanTier, endDate: string) =>
    `🎉 To'lovingiz tasdiqlandi!\n\nTarifingiz: <b>${TIER_LABEL[tier]}</b>\nAmal qilish muddati: <b>${endDate}</b> gacha.`,
  paymentRejectedUser: (reason?: string) =>
    `❌ To'lovingiz rad etildi.${reason ? `\n\nSabab: ${reason}` : ""}\n\nSavolingiz bo'lsa, /help orqali murojaat qiling.`,
  adminNewPaymentCaption: (input: {
    username: string;
    telegramUsername?: string;
    tier: PlanTier;
    duration: PlanDuration;
    amount: string;
    paymentId: string;
  }) =>
    `🆕 <b>Yangi to'lov (karta orqali)</b>\n\n` +
    `Foydalanuvchi: <b>${input.username}</b>${input.telegramUsername ? ` (@${input.telegramUsername})` : ""}\n` +
    `Tarif: <b>${TIER_LABEL[input.tier]}</b> — ${DURATION_LABEL[input.duration]}\n` +
    `Summa: <b>${input.amount}</b>\n` +
    `To'lov ID: <code>${input.paymentId}</code>`,
  adminApproveButton: "✅ Tasdiqlash",
  adminRejectButton: "❌ Rad etish",
  adminApproved: (byWhom: string) => `✅ Tasdiqlandi (${byWhom})`,
  adminRejected: (byWhom: string) => `❌ Rad etildi (${byWhom})`,
  adminPendingList: (count: number) => `🛠 <b>Kutilayotgan to'lovlar:</b> ${count}`,
  adminPendingEmpty: "Kutilayotgan to'lovlar yo'q.",
  reminderMessage: (tier: string, endDate: string, left: number) =>
    `⏰ <b>Obunangiz tugashiga ${left} kun qoldi!</b>\n\n` +
    `Tarif: <b>${tier}</b>\nMuddati: <b>${endDate}</b> gacha.\n\n` +
    `Uzilishning oldini olish uchun hoziroq uzaytiring.`,
  myPaymentsTitle: "🧾 <b>To'lovlarim</b>",
  myPaymentsEmpty: "Hozircha to'lovlar yo'q.",
  paymentStatusLabel: {
    pending: "⏳ Kutilmoqda",
    approved: "✅ Tasdiqlangan",
    completed: "✅ Bajarilgan",
    rejected: "❌ Rad etilgan",
    cancelled: "⚪️ Bekor qilingan",
  } as Record<string, string>,
  help:
    "🆘 <b>Yordam</b>\n\n" +
    `Savol yoki muammo bo'lsa: @${env.SUPPORT_TELEGRAM_USERNAME}\n\n` +
    "Buyruqlar:\n/start — bosh menyu\n/help — yordam",
  genericError: "❗️ Xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring yoki /help orqali murojaat qiling.",
  notAdmin: "Bu bo'lim faqat administratorlar uchun.",
  back: "◀️ Orqaga",
};
