import "dotenv/config";
import { Telegraf, Markup, session } from "telegraf";

import {
  initDB,
  readDB,
  updateDB,
  saveUser,
  getProduct,
  createProduct,
  updateProduct,
  addMovement,
  createOrder,
  updateOrderStatus,
  createSupplier
} from "./lib/store.js";

import {
  isAdmin,
  adminOnly,
  isValidPrice,
  isValidQuantity
} from "./lib/guards.js";

import {
  mainMenu,
  cancelMenu,
  adminMenu,
  productKeyboard,
  paginationKeyboard,
  money,
  statusText,
  escapeHTML
} from "./lib/ui.js";

const TOKEN = process.env.BOT_TOKEN;
const STORE_NAME = process.env.STORE_NAME || "Savdochi";
const LOW_STOCK_LIMIT = Number(process.env.LOW_STOCK_LIMIT || 5);

if (!TOKEN || TOKEN === "BOT_TOKENINGNI_SHU_YERGA_YOZ") {
  console.error("❌ .env faylida BOT_TOKEN ni to‘g‘ri kiriting.");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

bot.use(
  session({
    defaultSession: () => ({
      step: null,
      temp: {},
      cart: [],
      searchQuery: "",
      catalogPage: 0
    })
  })
);

bot.use(async (ctx, next) => {
  if (ctx.from) {
    try {
      await saveUser(ctx.from);
    } catch (error) {
      console.error("Foydalanuvchini saqlashda xato:", error.message);
    }
  }

  return next();
});

const waiting = (ctx, step, message) => {
  ctx.session.step = step;
  ctx.session.temp = {};
  return ctx.reply(message, cancelMenu());
};

const clearStep = (ctx) => {
  ctx.session.step = null;
  ctx.session.temp = {};
};

async function safeAnswer(ctx, text, extra = {}) {
  return ctx.reply(text, {
    parse_mode: "HTML",
    ...extra
  });
}

async function showHome(ctx) {
  return ctx.reply(
    `👋 Assalomu alaykum, ${escapeHTML(ctx.from?.first_name || "do‘st")}!\n\n` +
    `🛍 <b>${escapeHTML(STORE_NAME)}</b> do‘koniga xush kelibsiz!\n` +
    "Mahsulotlarni ko‘ring, savatchaga qo‘shing va buyurtma bering.",
    {
      parse_mode: "HTML",
      ...mainMenu()
    }
  );
}

async function showHelp(ctx) {
  const text =
    "ℹ️ <b>SAVDOCHI — YORDAM</b>\n\n" +
    "🛍 Katalog — mavjud mahsulotlar\n" +
    "🔎 Qidiruv — mahsulot izlash\n" +
    "🛒 Savatcham — savatchani boshqarish\n" +
    "📦 Buyurtmalarim — buyurtma tarixi\n" +
    "⭐ Sevimlilar — saqlangan mahsulotlar\n" +
    "👤 Profil — telefon va manzil\n" +
    "🏬 Ombor — ombordagi qoldiqlar\n\n" +
    "Buyurtma berish uchun katalogdan mahsulot tanlang.\n" +
    "Buyruqni bekor qilish uchun /cancel yuboring.";

  return safeAnswer(ctx, text, mainMenu());
}

async function showCatalog(ctx, page = 0, query = "") {
  const db = await readDB();

  const products = db.products.filter((product) => {
    if (!product.active) return false;

    if (!query) return true;

    const haystack = [
      product.name,
      product.category,
      product.description,
      product.barcode
    ].join(" ").toLowerCase();

    return haystack.includes(query.toLowerCase());
  });

  if (!products.length) {
    return ctx.reply(
      query
        ? `🔎 “${query}” bo‘yicha mahsulot topilmadi.`
        : "📭 Hozircha katalog bo‘sh.",
      mainMenu()
    );
  }

  const pageSize = 5;
  const totalPages = Math.ceil(products.length / pageSize);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const visible = products.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  const message = [
    `🛍 <b>${escapeHTML(STORE_NAME)} — KATALOG</b>`,
    `📦 Mahsulotlar: ${products.length}`,
    ""
  ];

  for (const product of visible) {
    message.push(
      `🆔 <code>${product.id}</code>`,
      `📌 <b>${escapeHTML(product.name)}</b>`,
      `🏷 ${escapeHTML(product.category || "Boshqa")}`,
      `💰 ${money(product.price)}`,
      `📦 Qoldiq: ${product.stock}`,
      escapeHTML(product.description || ""),
      ""
    );
  }

  const rows = visible.map((product) => [
    Markup.button.callback(
      `🔍 ${product.name.slice(0, 30)}`,
      `product:${product.id}`
    )
  ]);

  rows.push([
    Markup.button.callback("🔄 Yangilash", `catalog:page:${safePage}`)
  ]);

  const pagination = paginationKeyboard(
    safePage,
    totalPages,
    query ? "search" : "catalog"
  ).reply_markup.inline_keyboard;

  rows.push(...pagination);

  return safeAnswer(ctx, message.join("\n"), {
    reply_markup: { inline_keyboard: rows }
  });
}

async function showProduct(ctx, id) {
  const product = await getProduct(id);

  if (!product || !product.active) {
    return ctx.reply("❌ Mahsulot topilmadi.");
  }

  const text =
    `🛍 <b>${escapeHTML(product.name)}</b>\n\n` +
    `🆔 ID: <code>${product.id}</code>\n` +
    `🏷 Kategoriya: ${escapeHTML(product.category || "Boshqa")}\n` +
    `💰 Narx: <b>${money(product.price)}</b>\n` +
    `📦 Omborda: ${product.stock} dona\n` +
    `🧾 Shtrix-kod: <code>${escapeHTML(product.barcode || "Yo‘q")}</code>\n\n` +
    `📝 ${escapeHTML(product.description || "Tavsif yo‘q")}`;

  return safeAnswer(ctx, text, productKeyboard(product));
}

async function showCart(ctx) {
  const db = await readDB();
  const cart = ctx.session.cart || [];

  if (!cart.length) {
    return ctx.reply("🛒 Savatchangiz hozircha bo‘sh.", mainMenu());
  }

  const lines = ["🛒 <b>SAVATCHANGIZ</b>\n"];
  let total = 0;

  for (const item of cart) {
    const product = db.products.find(
      (entry) => entry.id === Number(item.productId)
    );

    if (!product || !product.active) continue;

    const subtotal = product.price * item.quantity;
    total += subtotal;

    lines.push(
      `📌 ${escapeHTML(product.name)}`,
      `   ${item.quantity} × ${money(product.price)} = ${money(subtotal)}`
    );
  }

  lines.push("", `💰 <b>Jami: ${money(total)}</b>`);

  return safeAnswer(ctx, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [
          Markup.button.callback("➕ Miqdor oshirish", "cart:increase"),
          Markup.button.callback("➖ Miqdor kamaytirish", "cart:decrease")
        ],
        [
          Markup.button.callback("🗑 Savatchani tozalash", "cart:clear")
        ],
        [
          Markup.button.callback("✅ Buyurtma berish", "checkout:start")
        ]
      ]
    }
  });
}

async function addToCart(ctx, productId) {
  const product = await getProduct(productId);

  if (!product || !product.active) {
    return ctx.answerCbQuery("Mahsulot topilmadi.");
  }

  if (product.stock < 1) {
    return ctx.answerCbQuery("Mahsulot omborda qolmagan.", {
      show_alert: true
    });
  }

  const cart = ctx.session.cart;
  const existing = cart.find(
    (item) => item.productId === product.id
  );

  if (existing) {
    if (existing.quantity >= product.stock) {
      return ctx.answerCbQuery("Ombordagi maksimal miqdorga yetdingiz.");
    }

    existing.quantity += 1;
  } else {
    cart.push({
      productId: product.id,
      quantity: 1
    });
  }

  await ctx.answerCbQuery("🛒 Savatchaga qo‘shildi!");
  return ctx.reply(
    `✅ ${product.name} savatchaga qo‘shildi.`,
    mainMenu()
  );
}

async function showOrders(ctx, adminMode = false) {
  const db = await readDB();

  const orders = adminMode
    ? db.orders
    : db.orders.filter((order) => order.userId === ctx.from.id);

  if (!orders.length) {
    return ctx.reply("📭 Buyurtmalar topilmadi.");
  }

  const selected = orders.slice(-15).reverse();

  for (const order of selected) {
    const itemsText = order.items
      .map((item) => `${item.name} × ${item.quantity}`)
      .join("\n");

    const text =
      `🧾 <b>Buyurtma #${order.id}</b>\n` +
      `👤 ${escapeHTML(order.customerName)}\n` +
      `📞 ${escapeHTML(order.phone)}\n` +
      `📍 ${escapeHTML(order.address)}\n\n` +
      `${escapeHTML(itemsText)}\n\n` +
      `💰 Jami: <b>${money(order.total)}</b>\n` +
      `📌 Holat: ${statusText(order.status)}\n` +
      `🕒 ${new Date(order.createdAt).toLocaleString("uz-UZ")}`;

    const extra = adminMode
      ? {
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback(
                  "🟡 Qabul qilish",
                  `orderstatus:${order.id}:accepted`
                ),
                Markup.button.callback(
                  "📦 Tayyorlash",
                  `orderstatus:${order.id}:preparing`
                )
              ],
              [
                Markup.button.callback(
                  "🚚 Yo‘lga chiqarish",
                  `orderstatus:${order.id}:shipped`
                ),
                Markup.button.callback(
                  "✅ Yakunlash",
                  `orderstatus:${order.id}:completed`
                )
              ],
              [
                Markup.button.callback(
                  "❌ Bekor qilish",
                  `orderstatus:${order.id}:cancelled`
                )
              ]
            ]
          }
        }
      : {};

    await safeAnswer(ctx, text, extra);
  }
}

async function showStats(ctx) {
  const db = await readDB();

  const activeProducts = db.products.filter((p) => p.active);
  const lowStock = activeProducts.filter(
    (p) => p.stock <= LOW_STOCK_LIMIT
  );

  const totalStockValue = activeProducts.reduce(
    (sum, p) => sum + p.price * p.stock,
    0
  );

  const completed = db.orders.filter(
    (order) => order.status === "completed"
  );

  const revenue = completed.reduce(
    (sum, order) => sum + order.total,
    0
  );

  const text =
    "📊 <b>BIZNES STATISTIKASI</b>\n\n" +
    `🛍 Faol mahsulotlar: ${activeProducts.length}\n` +
    `📦 Jami birliklar: ${activeProducts.reduce((s, p) => s + p.stock, 0)}\n` +
    `⚠️ Kam qolgan mahsulotlar: ${lowStock.length}\n` +
    `💎 Ombor qiymati: ${money(totalStockValue)}\n` +
    `🧾 Jami buyurtmalar: ${db.orders.length}\n` +
    `✅ Yakunlangan: ${completed.length}\n` +
    `💰 Yakunlangan buyurtmalar summasi: ${money(revenue)}\n` +
    `👥 Foydalanuvchilar: ${db.users.length}\n` +
    `🚚 Ta’minotchilar: ${db.suppliers.length}`;

  return safeAnswer(ctx, text, adminMenu());
}

async function showStock(ctx) {
  const db = await readDB();
  const products = db.products.filter((p) => p.active);

  if (!products.length) {
    return ctx.reply("📦 Omborda mahsulotlar yo‘q.");
  }

  const lines = ["🏬 <b>OMBOR QOLDIQLARI</b>\n"];

  for (const product of products) {
    const warning = product.stock <= LOW_STOCK_LIMIT ? " ⚠️" : "";

    lines.push(
      `${warning} <b>${escapeHTML(product.name)}</b>`,
      `   ID: ${product.id} | ${product.stock} dona`,
      `   ${money(product.price)}`,
      ""
    );
  }

  return safeAnswer(ctx, lines.join("\n"));
}

async function showFavorites(ctx) {
  const db = await readDB();
  const user = db.users.find((item) => item.id === ctx.from.id);

  const ids = user?.favorites || [];

  if (!ids.length) {
    return ctx.reply(
      "⭐ Sevimlilar ro‘yxatingiz bo‘sh. Katalogdan mahsulot saqlang."
    );
  }

  const products = db.products.filter(
    (product) => ids.includes(product.id) && product.active
  );

  const buttons = products.map((product) => [
    Markup.button.callback(
      `${product.name} — ${money(product.price)}`,
      `product:${product.id}`
    )
  ]);

  return ctx.reply("⭐ <b>SEVIMLILAR</b>", {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

async function showProfile(ctx) {
  const db = await readDB();
  const user = db.users.find((item) => item.id === ctx.from.id);

  const text =
    "👤 <b>PROFIL</b>\n\n" +
    `🆔 ID: <code>${ctx.from.id}</code>\n` +
    `👋 Ism: ${escapeHTML(user?.firstName || ctx.from.first_name || "")}\n` +
    `🔗 Username: ${user?.username ? "@" + escapeHTML(user.username) : "Yo‘q"}\n` +
    `📞 Telefon: ${escapeHTML(user?.phone || "Kiritilmagan")}\n` +
    `📍 Manzil: ${escapeHTML(user?.address || "Kiritilmagan")}\n` +
    `⭐ Sevimlilar: ${user?.favorites?.length || 0}`;

  return safeAnswer(ctx, text, {
    reply_markup: {
      inline_keyboard: [
        [
          Markup.button.callback("📞 Telefonni yangilash", "profile:phone"),
          Markup.button.callback("📍 Manzilni yangilash", "profile:address")
        ]
      ]
    }
  });
}

async function showSuppliers(ctx) {
  const db = await readDB();

  if (!db.suppliers.length) {
    return ctx.reply(
      "🚚 Ta’minotchilar ro‘yxati bo‘sh.",
      isAdmin(ctx.from.id)
        ? Markup.inlineKeyboard([
            Markup.button.callback("➕ Ta’minotchi qo‘shish", "supplier:add")
          ])
        : {}
    );
  }

  const lines = ["🚚 <b>TA’MINOTCHILAR</b>\n"];

  for (const supplier of db.suppliers) {
    lines.push(
      `#${supplier.id} — <b>${escapeHTML(supplier.name)}</b>`,
      `📞 ${escapeHTML(supplier.phone)}`,
      `📝 ${escapeHTML(supplier.note || "Izoh yo‘q")}`,
      ""
    );
  }

  const extra = isAdmin(ctx.from.id)
    ? Markup.inlineKeyboard([
        Markup.button.callback("➕ Yangi ta’minotchi", "supplier:add")
      ])
    : {};

  return safeAnswer(ctx, lines.join("\n"), extra);
}

// =========================
// TELEGRAM SLASH COMMANDS
// =========================

const commands = [
  { command: "start", description: "🏠 Bosh menyuni ochish" },
  { command: "help", description: "ℹ️ Yordam va qo‘llanma" },
  { command: "menu", description: "📱 Barcha menyular" },
  { command: "catalog", description: "🛍 Mahsulotlar katalogi" },
  { command: "search", description: "🔎 Mahsulot qidirish" },
  { command: "cart", description: "🛒 Savatchani ko‘rish" },
  { command: "checkout", description: "✅ Buyurtma berish" },
  { command: "orders", description: "📦 Buyurtmalarim" },
  { command: "favorites", description: "⭐ Sevimlilar" },
  { command: "profile", description: "👤 Profilim" },
  { command: "stock", description: "🏬 Ombor qoldiqlari" },
  { command: "business", description: "📊 Biznes paneli" },
  { command: "suppliers", description: "🚚 Ta’minotchilar" },
  { command: "admin", description: "⚙️ Admin paneli" },
  { command: "cancel", description: "❌ Amalni bekor qilish" }
];

bot.start(showHome);
bot.help(showHelp);

bot.command("menu", showHome);
bot.command("catalog", (ctx) => showCatalog(ctx));
bot.command("cart", showCart);
bot.command("orders", (ctx) => showOrders(ctx));
bot.command("favorites", showFavorites);
bot.command("profile", showProfile);
bot.command("stock", showStock);
bot.command("suppliers", showSuppliers);

bot.command("search", (ctx) => {
  return waiting(
    ctx,
    "search",
    "🔎 Mahsulot nomi yoki kategoriyasini yozing:"
  );
});

bot.command("checkout", (ctx) => startCheckout(ctx));

bot.command("business", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ Bu bo‘lim adminlar uchun.");
  }

  return showStats(ctx);
});

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ Sizda admin huquqi yo‘q.");
  }

  return ctx.reply("⚙️ <b>SAVDOCHI ADMIN PANEL</b>", {
    parse_mode: "HTML",
    ...adminMenu()
  });
});

bot.command("cancel", async (ctx) => {
  clearStep(ctx);
  return ctx.reply("❌ Amal bekor qilindi.", mainMenu());
});

// =========================
// MAIN REPLY KEYBOARD
// =========================

bot.hears("🛍 Katalog", (ctx) => showCatalog(ctx));
bot.hears("🔎 Qidiruv", (ctx) =>
  waiting(ctx, "search", "🔎 Mahsulot nomini yozing:")
);
bot.hears("🛒 Savatcham", showCart);
bot.hears("📦 Buyurtmalarim", (ctx) => showOrders(ctx));
bot.hears("⭐ Sevimlilar", showFavorites);
bot.hears("👤 Profil", showProfile);
bot.hears("🏬 Ombor", showStock);
bot.hears("📊 Biznes paneli", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ Bu bo‘lim adminlar uchun.");
  }

  return showStats(ctx);
});
bot.hears("🚚 Ta’minotchilar", showSuppliers);
bot.hears("ℹ️ Yordam", showHelp);

bot.hears("❌ Bekor qilish", async (ctx) => {
  clearStep(ctx);
  return ctx.reply("❌ Amal bekor qilindi.", mainMenu());
});

// =========================
// PRODUCT CALLBACKS
// =========================

bot.action(/^product:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  return showProduct(ctx, Number(ctx.match[1]));
});

bot.action(/^product:stock:(\d+)$/, async (ctx) => {
  const product = await getProduct(ctx.match[1]);
  await ctx.answerCbQuery();

  if (!product) {
    return ctx.reply("Mahsulot topilmadi.");
  }

  return ctx.reply(
    `📦 ${product.name}\nOmborda: ${product.stock} dona`
  );
});

bot.action(/^cart:add:(\d+)$/, async (ctx) => {
  return addToCart(ctx, Number(ctx.match[1]));
});

bot.action("noop", (ctx) => ctx.answerCbQuery());

// =========================
// CATALOG PAGINATION
// =========================

bot.action(/^catalog:page:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  return showCatalog(ctx, Number(ctx.match[1]));
});

bot.action(/^search:page:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  return showCatalog(
    ctx,
    Number(ctx.match[1]),
    ctx.session.searchQuery || ""
  );
});

// =========================
// CART MANAGEMENT
// =========================

bot.action("cart:clear", async (ctx) => {
  ctx.session.cart = [];
  await ctx.answerCbQuery("Savatcha tozalandi.");
  return ctx.reply("🗑 Savatcha tozalandi.", mainMenu());
});

bot.action("cart:increase", async (ctx) => {
  const cart = ctx.session.cart || [];

  if (!cart.length) {
    await ctx.answerCbQuery("Savatcha bo‘sh.");
    return;
  }

  ctx.session.step = "cart_increase";
  ctx.session.temp = {};

  await ctx.answerCbQuery();
  return ctx.reply(
    "Mahsulot ID raqami va miqdorni shu formatda yozing:\n\n<code>1 2</code>\n\nBu misolda ID 1 bo‘lgan mahsulot miqdori 2 taga oshiriladi.",
    { parse_mode: "HTML", ...cancelMenu() }
  );
});

bot.action("cart:decrease", async (ctx) => {
  const cart = ctx.session.cart || [];

  if (!cart.length) {
    await ctx.answerCbQuery("Savatcha bo‘sh.");
    return;
  }

  ctx.session.step = "cart_decrease";
  ctx.session.temp = {};

  await ctx.answerCbQuery();
  return ctx.reply(
    "Mahsulot ID raqami va kamaytiriladigan miqdorni yozing:\n\n<code>1 1</code>",
    { parse_mode: "HTML", ...cancelMenu() }
  );
});

// =========================
// FAVORITES
// =========================

bot.action(/^fav:(\d+)$/, async (ctx) => {
  const productId = Number(ctx.match[1]);

  const result = await updateDB((db) => {
    let user = db.users.find((item) => item.id === ctx.from.id);

    if (!user) {
      user = {
        id: ctx.from.id,
        firstName: ctx.from.first_name || "",
        username: ctx.from.username || "",
        phone: "",
        address: "",
        favorites: [],
        createdAt: new Date().toISOString()
      };

      db.users.push(user);
    }

    user.favorites ||= [];

    if (user.favorites.includes(productId)) {
      user.favorites = user.favorites.filter((id) => id !== productId);
      return false;
    }

    user.favorites.push(productId);
    return true;
  });

  await ctx.answerCbQuery(
    result ? "⭐ Sevimlilarga qo‘shildi" : "Sevimlilardan olib tashlandi"
  );
});

// =========================
// PROFILE
// =========================

bot.action("profile:phone", async (ctx) => {
  await ctx.answerCbQuery();
  return waiting(ctx, "profile_phone", "📞 Telefon raqamingizni yozing:");
});

bot.action("profile:address", async (ctx) => {
  await ctx.answerCbQuery();
  return waiting(ctx, "profile_address", "📍 Yetkazib berish manzilingizni yozing:");
});

// =========================
// CHECKOUT
// =========================

async function startCheckout(ctx) {
  if (!ctx.session.cart?.length) {
    return ctx.reply("🛒 Avval savatchaga mahsulot qo‘shing.");
  }

  ctx.session.temp = {};
  return waiting(ctx, "checkout_name", "👤 Ism-familiyangizni yozing:");
}

bot.action("checkout:start", async (ctx) => {
  await ctx.answerCbQuery();
  return startCheckout(ctx);
});

// =========================
// ADMIN PANEL
// =========================

bot.action("admin:stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return showStats(ctx);
});

bot.action("admin:orders", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return showOrders(ctx, true);
});

bot.action("admin:products", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return showCatalog(ctx);
});

bot.action("admin:add", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return waiting(ctx, "admin_product_name", "Mahsulot nomini kiriting:");
});

bot.action("admin:price", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return waiting(
    ctx,
    "admin_price",
    "Mahsulot ID raqami va yangi narxni yozing.\nMisol: <code>1 99000</code>",
  );
});

bot.action("admin:stockin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return waiting(
    ctx,
    "admin_stockin",
    "Mahsulot ID va kirim miqdorini yozing.\nMisol: <code>1 10</code>"
  );
});

bot.action("admin:stockout", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return waiting(
    ctx,
    "admin_stockout",
    "Mahsulot ID va chiqim miqdorini yozing.\nMisol: <code>1 2</code>"
  );
});

bot.action("admin:suppliers", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return showSuppliers(ctx);
});

bot.action("supplier:add", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.");

  await ctx.answerCbQuery();
  return waiting(ctx, "supplier_name", "Ta’minotchi nomini kiriting:");
});

bot.action(/^orderstatus:(\d+):(new|accepted|preparing|shipped|completed|cancelled)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Admin ruxsati kerak.");
  }

  const orderId = Number(ctx.match[1]);
  const status = ctx.match[2];

  const db = await readDB();
  const previous = db.orders.find((order) => order.id === orderId);

  if (!previous) {
    return ctx.answerCbQuery("Buyurtma topilmadi.");
  }

  // Bekor qilingan buyurtma ombor qoldig‘ini qaytaradi.
  // Faqat birinchi marta bekor qilinganda.
  if (status === "cancelled" && previous.status !== "cancelled") {
    await updateDB((data) => {
      const order = data.orders.find((item) => item.id === orderId);

      if (!order || order.status === "cancelled") return;

      for (const item of order.items) {
        const product = data.products.find(
          (p) => p.id === item.productId
        );

        if (product) product.stock += item.quantity;
      }
    });
  }

  const updated = await updateOrderStatus(orderId, status);

  await ctx.answerCbQuery("Buyurtma holati yangilandi.");

  if (updated) {
    try {
      await ctx.telegram.sendMessage(
        updated.userId,
        `📦 <b>#${updated.id}</b> buyurtmangiz holati:\n${statusText(updated.status)}`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.warn("Mijozga xabar yuborilmadi:", error.message);
    }
  }

  return ctx.reply(`✅ Buyurtma #${orderId}: ${statusText(status)}`);
});

// =========================
// TEXT INPUT HANDLER
// =========================

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const step = ctx.session.step;

  // Menyu tugmalari va komandalar boshqa handlerlarga tegishli.
  if (!step || text.startsWith("/")) return;

  try {
    switch (step) {
      // -------------------------
      // PRODUCT SEARCH
      // -------------------------
      case "search": {
        if (text.length < 2) {
          return ctx.reply("Kamida 2 ta belgi kiriting.");
        }

        ctx.session.searchQuery = text;
        clearStep(ctx);

        return showCatalog(ctx, 0, text);
      }

      // -------------------------
      // CART QUANTITY
      // -------------------------
      case "cart_increase":
      case "cart_decrease": {
        const [idText, quantityText] = text.split(/\s+/);
        const id = Number(idText);
        const quantity = Number(quantityText);

        if (
          !Number.isInteger(id) ||
          !Number.isInteger(quantity) ||
          quantity < 1
        ) {
          return ctx.reply(
            "❌ Format noto‘g‘ri. Masalan: <code>1 2</code>",
            { parse_mode: "HTML" }
          );
        }

        const cartItem = ctx.session.cart.find(
          (item) => item.productId === id
        );

        if (!cartItem) {
          return ctx.reply("Bu mahsulot savatchangizda yo‘q.");
        }

        if (step === "cart_increase") {
          const product = await getProduct(id);

          if (!product || cartItem.quantity + quantity > product.stock) {
            return ctx.reply(
              `Omborda yetarli mahsulot yo‘q. Qoldiq: ${product?.stock ?? 0}`
            );
          }

          cartItem.quantity += quantity;
        } else {
          cartItem.quantity -= quantity;

          if (cartItem.quantity <= 0) {
            ctx.session.cart = ctx.session.cart.filter(
              (item) => item.productId !== id
            );
          }
        }

        clearStep(ctx);
        await ctx.reply("✅ Savatcha yangilandi.", mainMenu());
        return showCart(ctx);
      }

      // -------------------------
      // PROFILE PHONE
      // -------------------------
      case "profile_phone": {
        const phone = text.replace(/[\s()-]/g, "");

        if (!/^\+?\d{9,15}$/.test(phone)) {
          return ctx.reply(
            "❌ Telefon raqami noto‘g‘ri. Masalan: +998901234567"
          );
        }

        await updateDB((db) => {
          const user = db.users.find((u) => u.id === ctx.from.id);
          if (user) user.phone = phone;
        });

        clearStep(ctx);
        await ctx.reply("✅ Telefon raqamingiz saqlandi.", mainMenu());
        return showProfile(ctx);
      }

      // -------------------------
      // PROFILE ADDRESS
      // -------------------------
      case "profile_address": {
        if (text.length < 5 || text.length > 300) {
          return ctx.reply("Manzilni 5–300 ta belgi bilan kiriting.");
        }

        await updateDB((db) => {
          const user = db.users.find((u) => u.id === ctx.from.id);
          if (user) user.address = text;
        });

        clearStep(ctx);
        await ctx.reply("✅ Manzilingiz saqlandi.", mainMenu());
        return showProfile(ctx);
      }

      // -------------------------
      // CHECKOUT NAME
      // -------------------------
      case "checkout_name": {
        if (text.length < 2 || text.length > 100) {
          return ctx.reply("Ism-familiyangizni to‘g‘ri kiriting.");
        }

        ctx.session.temp.customerName = text;
        return waiting(
          ctx,
          "checkout_phone",
          "📞 Telefon raqamingizni kiriting:\nMasalan: +998901234567"
        );
      }

      // -------------------------
      // CHECKOUT PHONE
      // -------------------------
      case "checkout_phone": {
        const phone = text.replace(/[\s()-]/g, "");

        if (!/^\+?\d{9,15}$/.test(phone)) {
          return ctx.reply("Telefon noto‘g‘ri. Masalan: +998901234567");
        }

        ctx.session.temp.phone = phone;

        return waiting(
          ctx,
          "checkout_address",
          "📍 Buyurtmani yetkazish manzilini kiriting:"
        );
      }

      // -------------------------
      // CHECKOUT ADDRESS
      // -------------------------
      case "checkout_address": {
        if (text.length < 5 || text.length > 300) {
          return ctx.reply("Manzilni 5–300 ta belgi bilan kiriting.");
        }

        ctx.session.temp.address = text;

        const db = await readDB();
        let total = 0;
        const lines = [];

        for (const item of ctx.session.cart) {
          const product = db.products.find(
            (p) => p.id === item.productId && p.active
          );

          if (!product || product.stock < item.quantity) {
            return ctx.reply(
              `❌ ${product?.name || "Mahsulot"} mavjudligi o‘zgargan. Savatchani tekshiring.`
            );
          }

          const subtotal = product.price * item.quantity;
          total += subtotal;

          lines.push(
            `${product.name} × ${item.quantity} — ${money(subtotal)}`
          );
        }

        if (!lines.length) {
          clearStep(ctx);
          return ctx.reply("Savatcha bo‘sh.", mainMenu());
        }

        return ctx.reply(
          "🧾 <b>BUYURTMANI TASDIQLASH</b>\n\n" +
          `👤 Ism: ${escapeHTML(ctx.session.temp.customerName)}\n` +
          `📞 Telefon: ${escapeHTML(ctx.session.temp.phone)}\n` +
          `📍 Manzil: ${escapeHTML(ctx.session.temp.address)}\n\n` +
          `${lines.map(escapeHTML).join("\n")}\n\n` +
          `💰 Jami: <b>${money(total)}</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  Markup.button.callback(
                    "✅ Tasdiqlash",
                    "checkout:confirm"
                  ),
                  Markup.button.callback(
                    "❌ Bekor qilish",
                    "checkout:cancel"
                  )
                ]
              ]
            }
          }
        );
      }

      // -------------------------
      // ADMIN: ADD PRODUCT
      // -------------------------
      case "admin_product_name": {
        if (!isAdmin(ctx.from.id)) {
          clearStep(ctx);
          return ctx.reply("⛔ Ruxsat yo‘q.");
        }

        if (text.length < 2 || text.length > 100) {
          return ctx.reply("Mahsulot nomi 2–100 ta belgi bo‘lsin.");
        }

        ctx.session.temp.productName = text;

        return waiting(
          ctx,
          "admin_product_category",
          "🏷 Mahsulot kategoriyasini kiriting:"
        );
      }

      case "admin_product_category": {
        ctx.session.temp.category = text;

        return waiting(
          ctx,
          "admin_product_price",
          "💰 Mahsulot narxini faqat raqam bilan kiriting:"
        );
      }

      case "admin_product_price": {
        if (!isValidPrice(text) || Number(text) <= 0) {
          return ctx.reply("Narx 0 dan katta raqam bo‘lishi kerak.");
        }

        ctx.session.temp.price = Number(text);

        return waiting(
          ctx,
          "admin_product_stock",
          "📦 Boshlang‘ich ombor miqdorini kiriting:"
        );
      }

      case "admin_product_stock": {
        if (!isValidQuantity(text)) {
          return ctx.reply("Miqdor manfiy bo‘lmagan butun son bo‘lsin.");
        }

        ctx.session.temp.stock = Number(text);

        return waiting(
          ctx,
          "admin_product_description",
          "📝 Mahsulot tavsifini kiriting:"
        );
      }

      case "admin_product_description": {
        const temp = ctx.session.temp;

        const product = await createProduct({
          name: temp.productName,
          category: temp.category,
          price: temp.price,
          stock: temp.stock,
          description: text
        });

        clearStep(ctx);

        return ctx.reply(
          `✅ Mahsulot qo‘shildi!\n\n` +
          `🆔 ID: ${product.id}\n` +
          `📌 ${product.name}\n` +
          `💰 ${money(product.price)}\n` +
          `📦 ${product.stock} dona`,
          adminMenu()
        );
      }

      // -------------------------
      // ADMIN: CHANGE PRICE
      // -------------------------
      case "admin_price": {
        const [idText, priceText] = text.split(/\s+/);
        const id = Number(idText);
        const price = Number(priceText);

        if (
          !Number.isInteger(id) ||
          !isValidPrice(priceText) ||
          price <= 0
        ) {
          return ctx.reply(
            "❌ Format noto‘g‘ri. Masalan: <code>1 99000</code>",
            { parse_mode: "HTML" }
          );
        }

        const product = await updateProduct(id, { price });

        if (!product) {
          return ctx.reply("Mahsulot topilmadi.");
        }

        clearStep(ctx);
        return ctx.reply(
          `✅ ${product.name} yangi narxi: ${money(product.price)}`,
          adminMenu()
        );
      }

      // -------------------------
      // ADMIN: STOCK IN / OUT
      // -------------------------
      case "admin_stockin":
      case "admin_stockout": {
        if (!isAdmin(ctx.from.id)) {
          clearStep(ctx);
          return ctx.reply("⛔ Ruxsat yo‘q.");
        }

        const [idText, quantityText] = text.split(/\s+/);
        const id = Number(idText);
        const quantity = Number(quantityText);

        if (
          !Number.isInteger(id) ||
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {
          return ctx.reply(
            "❌ Format noto‘g‘ri. Masalan: <code>1 10</code>",
            { parse_mode: "HTML" }
          );
        }

        try {
          const result = await addMovement({
            productId: id,
            type: step === "admin_stockin" ? "in" : "out",
            quantity,
            note: `Admin Telegram ID: ${ctx.from.id}`
          });

          clearStep(ctx);

          return ctx.reply(
            `✅ Ombor yangilandi!\n` +
            `📌 ${result.product.name}\n` +
            `📦 Yangi qoldiq: ${result.product.stock}`,
            adminMenu()
          );
        } catch (error) {
          return ctx.reply(`❌ ${error.message}`);
        }
      }

      // -------------------------
      // ADD SUPPLIER
      // -------------------------
      case "supplier_name": {
        if (!isAdmin(ctx.from.id)) {
          clearStep(ctx);
          return ctx.reply("⛔ Ruxsat yo‘q.");
        }

        ctx.session.temp.supplierName = text;

        return waiting(
          ctx,
          "supplier_phone",
          "Ta’minotchining telefon raqamini kiriting:"
        );
      }

      case "supplier_phone": {
        const phone = text.replace(/[\s()-]/g, "");

        if (!/^\+?\d{9,15}$/.test(phone)) {
          return ctx.reply("Telefon raqamini tekshirib qayta kiriting.");
        }

        ctx.session.temp.supplierPhone = phone;

        return waiting(
          ctx,
          "supplier_note",
          "📝 Ta’minotchi haqida izoh yozing. Izoh bo‘lmasa, - yuboring:"
        );
      }

      case "supplier_note": {
        const supplier = await createSupplier(
          ctx.session.temp.supplierName,
          ctx.session.temp.supplierPhone,
          text === "-" ? "" : text
        );

        clearStep(ctx);

        return ctx.reply(
          `✅ Ta’minotchi qo‘shildi: ${supplier.name}`,
          adminMenu()
        );
      }

      default: {
        clearStep(ctx);
        return ctx.reply(
          "Bu amalni tushunmadim. /menu orqali qayta boshlang.",
          mainMenu()
        );
      }
    }
  } catch (error) {
    console.error("Matnni qayta ishlash xatosi:", error);
    return ctx.reply("❌ Xatolik yuz berdi. Qayta urinib ko‘ring.");
  }
});

// =========================
// CONFIRM CHECKOUT
// =========================

bot.action("checkout:confirm", async (ctx) => {
  await ctx.answerCbQuery();

  const temp = ctx.session.temp || {};

  if (
    !temp.customerName ||
    !temp.phone ||
    !temp.address ||
    !ctx.session.cart?.length
  ) {
    clearStep(ctx);
    return ctx.reply(
      "❌ Buyurtma ma’lumotlari to‘liq emas. Qayta urinib ko‘ring.",
      mainMenu()
    );
  }

  try {
    const order = await createOrder({
      userId: ctx.from.id,
      items: ctx.session.cart,
      customerName: temp.customerName,
      phone: temp.phone,
      address: temp.address
    });

    ctx.session.cart = [];
    clearStep(ctx);

    await ctx.reply(
      `🎉 <b>BUYURTMA QABUL QILINDI!</b>\n\n` +
      `🧾 Buyurtma: #${order.id}\n` +
      `💰 Jami: ${money(order.total)}\n` +
      `📌 Holat: ${statusText(order.status)}\n\n` +
      "Operator buyurtmangizni ko‘rib chiqadi.",
      { parse_mode: "HTML", ...mainMenu() }
    );

    // Adminlarga yangi buyurtma xabari.
    const adminIds = (process.env.ADMIN_IDS || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite);

    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(
          adminId,
          `🆕 YANGI BUYURTMA #${order.id}\n` +
          `👤 ${order.customerName}\n` +
          `📞 ${order.phone}\n` +
          `📍 ${order.address}\n` +
          `💰 ${money(order.total)}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  Markup.button.callback(
                    "🧾 Buyurtmani ochish",
                    "admin:orders"
                  )
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.warn("Adminga xabar yuborilmadi:", error.message);
      }
    }
  } catch (error) {
    console.error("Buyurtma xatosi:", error);
    return ctx.reply(`❌ Buyurtma yaratilmadi: ${error.message}`);
  }
});

bot.action("checkout:cancel", async (ctx) => {
  await ctx.answerCbQuery("Buyurtma bekor qilindi.");
  clearStep(ctx);
  return ctx.reply("Buyurtma berish bekor qilindi.", mainMenu());
});

// =========================
// ERROR HANDLER
// =========================

bot.catch((error, ctx) => {
  console.error(
    `Telegram xatosi (${ctx.updateType}):`,
    error
  );
});

// =========================
// START BOT
// =========================

async function startBot() {
  await initDB();

  await bot.telegram.setMyCommands(commands);

  await bot.launch();

  console.log(`🟢 ${STORE_NAME} Pro ishga tushdi!`);
  console.log("Slash komandalar Telegram menyusiga yuborildi.");
}

startBot().catch((error) => {
  console.error("Botni ishga tushirishda xato:", error);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));