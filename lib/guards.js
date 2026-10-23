import "dotenv/config";

const adminIds = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);

export function isAdmin(userId) {
  return adminIds.includes(Number(userId));
}

export function adminOnly(ctx, next) {
  if (!isAdmin(ctx.from?.id)) {
    return ctx.reply("⛔ Bu bo‘lim faqat administratorlar uchun.");
  }

  return next();
}

export function cancelSession(ctx) {
  ctx.session.step = null;
  ctx.session.temp = {};
  return ctx.reply(
    "❌ Amal bekor qilindi.",
    {
      reply_markup: {
        remove_keyboard: true
      }
    }
  );
}

export function isValidPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

export function isValidQuantity(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}