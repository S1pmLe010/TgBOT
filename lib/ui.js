import { Markup } from "telegraf";

export const mainMenu = () =>
  Markup.keyboard([
    ["🛍 Katalog", "🔎 Qidiruv"],
    ["🛒 Savatcham", "📦 Buyurtmalarim"],
    ["⭐ Sevimlilar", "👤 Profil"],
    ["🏬 Ombor", "📊 Biznes paneli"],
    ["🚚 Ta’minotchilar", "ℹ️ Yordam"]
  ]).resize();

export const cancelMenu = () =>
  Markup.keyboard([["❌ Bekor qilish"]]).resize();

export const adminMenu = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("➕ Mahsulot qo‘shish", "admin:add"),
      Markup.button.callback("📦 Mahsulotlar", "admin:products")
    ],
    [
      Markup.button.callback("🧾 Buyurtmalar", "admin:orders"),
      Markup.button.callback("📊 Statistika", "admin:stats")
    ],
    [
      Markup.button.callback("📥 Omborga kirim", "admin:stockin"),
      Markup.button.callback("📤 Ombordan chiqim", "admin:stockout")
    ],
    [
      Markup.button.callback("🚚 Ta’minotchilar", "admin:suppliers"),
      Markup.button.callback("💰 Narxni o‘zgartirish", "admin:price")
    ]
  ]);

export function productKeyboard(product) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🛒 Savatchaga", `cart:add:${product.id}`),
      Markup.button.callback("⭐ Sevimli", `fav:${product.id}`)
    ],
    [
      Markup.button.callback("📦 Ombor holati", `product:stock:${product.id}`)
    ]
  ]);
}

export function paginationKeyboard(page, totalPages, prefix = "catalog") {
  const buttons = [];

  if (page > 0) {
    buttons.push(
      Markup.button.callback("⬅️ Oldingi", `${prefix}:page:${page - 1}`)
    );
  }

  buttons.push(
    Markup.button.callback(`${page + 1}/${totalPages}`, "noop")
  );

  if (page + 1 < totalPages) {
    buttons.push(
      Markup.button.callback("Keyingi ➡️", `${prefix}:page:${page + 1}`)
    );
  }

  return Markup.inlineKeyboard([buttons]);
}

export function money(value) {
  return `${Number(value || 0).toLocaleString("uz-UZ")} so‘m`;
}

export function statusText(status) {
  const statuses = {
    new: "🆕 Yangi",
    accepted: "🟡 Qabul qilindi",
    preparing: "📦 Tayyorlanmoqda",
    shipped: "🚚 Yo‘lda",
    completed: "✅ Yakunlandi",
    cancelled: "❌ Bekor qilindi"
  };

  return statuses[status] || status;
}

export function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}