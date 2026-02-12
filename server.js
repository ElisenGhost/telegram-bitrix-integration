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

const TELEGRAM_FIELD = "UF_CRM_TELEGRAM_CHAT_ID";

const BITRIX_WEBHOOK_URL = `https://${B24_DOMAIN}/rest/${B24_WEBHOOK_USER}/${B24_WEBHOOK_KEY}`;

// === Поиск активной заявки ===
async function findActiveItem(chatId) {
  const response = await axios.post(
    `${BITRIX_WEBHOOK_URL}/crm.item.list.json`,
    {
      entityTypeId: SPA_TYPE_ID,
      filter: {
        [TELEGRAM_FIELD]: chatId,
        "=STAGE_ID": "DT" + SPA_TYPE_ID + ":NEW" // Стадия NEW (можно поменять)
      }
    }
  );

  return response.data.result.items[0] || null;
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

    console.log("Message:", chatId, text);

    let item = await findActiveItem(chatId);

    if (item) {
      console.log("Active ticket found:", item.id);
      await addComment(item.id, "👤 Telegram: " + text);
    } else {
      console.log("Creating new ticket");
      const itemId = await createItem(chatId, text);
      await addComment(itemId, "👤 Telegram: " + text);
    }

    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: "Сообщение добавлено к вашей заявке ✅"
      }
    );

    res.sendStatus(200);
  } catch (error) {
    console.error("ERROR:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
