import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const DB_PATH = path.join(ROOT, "data.json");

const initialDB = {
  products: [],
  users: [],
  orders: [],
  suppliers: [],
  movements: [],
  nextProductId: 1,
  nextOrderId: 1,
  nextSupplierId: 1
};

let writeQueue = Promise.resolve();

export async function initDB() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(
      DB_PATH,
      JSON.stringify(initialDB, null, 2),
      "utf8"
    );
  }

  const db = await readDB();

  for (const key of Object.keys(initialDB)) {
    if (db[key] === undefined) {
      db[key] = structuredClone(initialDB[key]);
    }
  }

  await writeDB(db);
}

export async function readDB() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return { ...structuredClone(initialDB), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === "ENOENT") {
      return structuredClone(initialDB);
    }

    throw error;
  }
}

export async function writeDB(db) {
  const task = async () => {
    const temporaryPath = `${DB_PATH}.tmp`;

    await fs.writeFile(
      temporaryPath,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    await fs.rename(temporaryPath, DB_PATH);
  };

  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

export async function updateDB(callback) {
  const db = await readDB();
  const result = await callback(db);
  await writeDB(db);
  return result;
}

export async function getProduct(id) {
  const db = await readDB();
  return db.products.find((item) => item.id === Number(id));
}

export async function getUser(id) {
  const db = await readDB();
  return db.users.find((item) => item.id === Number(id));
}

export async function saveUser(user) {
  return updateDB((db) => {
    let existing = db.users.find((item) => item.id === user.id);

    if (!existing) {
      existing = {
        id: user.id,
        firstName: user.first_name || "",
        username: user.username || "",
        phone: "",
        address: "",
        favorites: [],
        createdAt: new Date().toISOString()
      };

      db.users.push(existing);
    }

    existing.firstName = user.first_name || existing.firstName;
    existing.username = user.username || existing.username;
    existing.updatedAt = new Date().toISOString();

    return existing;
  });
}

export async function createProduct(input) {
  return updateDB((db) => {
    const product = {
      id: db.nextProductId++,
      name: input.name,
      category: input.category || "Boshqa",
      price: Number(input.price),
      stock: Number(input.stock),
      description: input.description || "Tavsif kiritilmagan.",
      barcode: input.barcode || "",
      active: true,
      createdAt: new Date().toISOString()
    };

    db.products.push(product);
    return product;
  });
}

export async function updateProduct(id, changes) {
  return updateDB((db) => {
    const product = db.products.find(
      (item) => item.id === Number(id)
    );

    if (!product) return null;

    Object.assign(product, changes, {
      updatedAt: new Date().toISOString()
    });

    return product;
  });
}

export async function addMovement({
  productId,
  type,
  quantity,
  note = ""
}) {
  return updateDB((db) => {
    const product = db.products.find(
      (item) => item.id === Number(productId)
    );

    if (!product) {
      throw new Error("Mahsulot topilmadi.");
    }

    const amount = Number(quantity);

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("Miqdor musbat butun son bo‘lishi kerak.");
    }

    if (type === "in") {
      product.stock += amount;
    } else if (type === "out") {
      if (product.stock < amount) {
        throw new Error("Omborda yetarli mahsulot yo‘q.");
      }

      product.stock -= amount;
    } else {
      throw new Error("Noto‘g‘ri harakat turi.");
    }

    const movement = {
      id: db.movements.length
        ? db.movements.at(-1).id + 1
        : 1,
      productId: product.id,
      type,
      quantity: amount,
      note,
      createdAt: new Date().toISOString()
    };

    db.movements.push(movement);

    return { product, movement };
  });
}

export async function createOrder({
  userId,
  items,
  customerName,
  phone,
  address
}) {
  return updateDB((db) => {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Savatcha bo‘sh.");
    }

    const validatedItems = [];
    let total = 0;

    for (const item of items) {
      const product = db.products.find(
        (entry) => entry.id === Number(item.productId)
      );

      const quantity = Number(item.quantity);

      if (
        !product ||
        !product.active ||
        !Number.isInteger(quantity) ||
        quantity < 1
      ) {
        throw new Error("Buyurtmadagi mahsulot ma’lumotlari noto‘g‘ri.");
      }

      if (product.stock < quantity) {
        throw new Error(
          `${product.name}: omborda faqat ${product.stock} dona bor.`
        );
      }

      validatedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
        subtotal: product.price * quantity
      });

      total += product.price * quantity;
    }

    for (const item of validatedItems) {
      const product = db.products.find(
        (entry) => entry.id === item.productId
      );

      product.stock -= item.quantity;
    }

    const order = {
      id: db.nextOrderId++,
      userId: Number(userId),
      items: validatedItems,
      customerName,
      phone,
      address,
      total,
      status: "new",
      createdAt: new Date().toISOString()
    };

    db.orders.push(order);
    return order;
  });
}

export async function updateOrderStatus(id, status) {
  return updateDB((db) => {
    const order = db.orders.find(
      (item) => item.id === Number(id)
    );

    if (!order) return null;

    order.status = status;
    order.updatedAt = new Date().toISOString();

    return order;
  });
}

export async function createSupplier(name, phone, note = "") {
  return updateDB((db) => {
    const supplier = {
      id: db.nextSupplierId++,
      name,
      phone,
      note,
      createdAt: new Date().toISOString()
    };

    db.suppliers.push(supplier);
    return supplier;
  });
}