import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TG_TOKEN;
const B24_DOMAIN = process.env.B24_DOMAIN;
const B24_WEBHOOK_USER = process.env.B24_WEBHOOK_USER;
const B24_WEBHOOK_KEY = process.env.B24_WEBHOOK_KEY;
const SPA_TYPE_ID = Number(process.env.SPA_TYPE_ID);

// Код пользовательского поля Telegram ID в SPA
const TELEGRAM_FIELD = "UF_CRM_TELEGRAM_CHAT_ID";

const BITRIX_WEBHOOK_URL = `https://${B24_DOMAIN}/rest/${B24_WEBHOOK_USER}/${B24_WEBHOOK_KEY}`;

if (!TG_TOKEN || !B24_DOMAIN || !B24_WEBHOOK_USER || !B24_WEBHOOK_KEY || !SPA_TYPE_ID) {
  console.error("❌ ERROR: Missing environment variables");
  process.exit(1);
}

// === Поиск активной заявки ===
async function findActiveItem(chatId) {
  try {
    const response = await axios.post(
      `${BITRIX_WEBHOOK_URL}/crm.item.list.json`,
      {
        entityTypeId: SPA_TYPE_ID,
        select: ["ID", TELEGRAM_FIELD, "STAGE_ID"],
        order: { ID: "DESC" },
        start: 0,
      }
    );

    // Фильтруем на сервере
    const activeItem = response.data.result.items.find(
      item =>
        item[TELEGRAM_FIELD] == chatId &&
        item.STAGE_ID !== "closed" // замените "closed" на вашу закрытую стадию
    );

    return activeItem || null;
  } catch (err) {
    console.error("Error fetching items:", err.response?.data || err.message);
    return null;
  }
}

// === Создание заявки ===
async function createItem(chatId, text) {
  const response = await axios.post(
    `${BITRIX_WEBHOOK_URL}/crm.item.add.json`,
    {
      entityTypeId: SPA_TYPE_ID,
      fields: {
        TITLE: text,
        [TELEGRAM_FIELD]: chatId
      }
    }
  );
  return response.data.result;
}

// === Добавление комментария ===
async function addComment(itemId, text) {
  await axios.post(
    `${BITRIX_WEBHOOK_URL}/crm.timeline.comment.add.json`,
    {
      fields: {
        ENTITY_ID: itemId,
        ENTITY_TYPE: "smart_process",
        COMMENT: text
      }
    }
  );
}

// === Telegram webhook ===
app.post("/telegram/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    console.log("Message from Telegram:", chatId, text);

    let item = await findActiveItem(chatId);

    if (item) {
      console.log("Active ticket found:", item.ID);
      await addComment(item.ID, "👤 Telegram: " + text);
    } else {
      console.log("Creating new ticket");
      const itemId = await createItem(chatId, text);
      await addComment(itemId, "👤 Telegram: " + text);
    }

    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: "✅ Ваше сообщение добавлено к вашей заявке"
      }
    );

    res.sendStatus(200);
  } catch (error) {
    console.error("ERROR:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// Просто для проверки
app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
