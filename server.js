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

const BITRIX_WEBHOOK_URL = `https://${B24_DOMAIN}/rest/${B24_WEBHOOK_USER}/${B24_WEBHOOK_KEY}`;

if (!TG_TOKEN || !B24_DOMAIN || !B24_WEBHOOK_USER || !B24_WEBHOOK_KEY || !SPA_TYPE_ID) {
  console.error("❌ ERROR: Missing environment variables");
  process.exit(1);
}

app.post("/telegram/webhook", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text;

    console.log("Received message from Telegram:", chatId, text);
    console.log("Creating SPA with entityTypeId:", SPA_TYPE_ID);

    // СОЗДАНИЕ СМАРТ-ПРОЦЕССА
    const bitrixResponse = await axios.post(
      `${BITRIX_WEBHOOK_URL}/crm.item.add.json`,
      {
        entityTypeId: SPA_TYPE_ID,
        fields: {
          TITLE: text,
        },
      }
    );

    console.log("Bitrix response:", bitrixResponse.data);

    // Ответ пользователю
    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: "✅ Ваша заявка создана!",
      }
    );

    res.sendStatus(200);
  } catch (error) {
    console.error("Internal error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("Server is working");
});

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
