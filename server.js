const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

app.post('/telegram/webhook', async (req, res) => {
    try {
        const message = req.body.message;
        if (!message) {
            console.log("No message in body:", req.body);
            return res.sendStatus(200);
        }

        const chatId = message.chat.id;
        const text = message.text;

        console.log("Received message from Telegram:", chatId, text);

        // Отправка в Bitrix
        const response = await axios.post(
            `https://${process.env.B24_DOMAIN}/rest/${process.env.B24_WEBHOOK_USER}/${process.env.B24_WEBHOOK_KEY}/crm.item.add`,
            {
                fields: {
                    TITLE: text,
                    SPA_TYPE_ID: process.env.SPA_TYPE_ID
                }
            }
        );

        console.log("Bitrix response:", response.data);
        res.sendStatus(200);

    } catch (err) {
        console.error("Internal error:", err.response ? err.response.data : err.message);
        res.status(500).send("Internal Server Error");
    }
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
