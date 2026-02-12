// server.js
// Telegram <-> Bitrix24 integration with detailed logging
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const B24_DOMAIN = process.env.B24_DOMAIN;
const B24_WEBHOOK_USER = process.env.B24_WEBHOOK_USER;
const B24_WEBHOOK_KEY = process.env.B24_WEBHOOK_KEY;
const SPA_TYPE_ID = process.env.SPA_TYPE_ID; // integer string
const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || null;

if (!TELEGRAM_BOT_TOKEN || !B24_DOMAIN || !B24_WEBHOOK_USER || !B24_WEBHOOK_KEY || !SPA_TYPE_ID) {
  console.error('ERROR: please fill .env with TG_TOKEN, B24_DOMAIN, B24_WEBHOOK_USER, B24_WEBHOOK_KEY, SPA_TYPE_ID');
  process.exit(1);
}

const B24_BASE = `https://${B24_DOMAIN}/rest/${B24_WEBHOOK_USER}/${B24_WEBHOOK_KEY}`;

// Simple local mapping storage (chat_id -> item_id)
const MAPPING_FILE = './mapping.json';
let mapping = {};
try {
  if (fs.existsSync(MAPPING_FILE)) {
    mapping = JSON.parse(fs.readFileSync(MAPPING_FILE));
  } else {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify({}));
  }
} catch (e) {
  console.warn('Could not read mapping.json, starting with empty mapping.');
  mapping = {};
}

function saveMapping() {
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2));
}

async function b24Call(method, params = {}) {
  const url = `${B24_BASE}/${method}`;
  try {
    const res = await axios.post(url, params);
    console.log('Bitrix response for', method, ':', JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (err) {
    console.error('Bitrix API error', method, err.response?.data || err.message || err);
    throw err;
  }
}

async function findItemByChatId(chatId) {
  try {
    const resp = await b24Call('crm.item.list', {
      filter: { 'UF_CRM_TELEGRAM_CHAT_ID': chatId.toString() },
      select: ['ID'],
      entityTypeId: SPA_TYPE_ID
    });
    if (resp?.result?.length) return resp.result[0].ID;
    return null;
  } catch (e) {
    console.warn('crm.item.list failed, falling back to local mapping.');
    return mapping[chatId] || null;
  }
}

async function createSpaItemFromTelegram(chatId, text, user) {
  const fields = {
    TITLE: `Telegram: ${user?.first_name || chatId}`,
    UF_CRM_TELEGRAM_CHAT_ID: chatId.toString(),
    DESCRIPTION: text || ''
  };
  const params = { fields, entityTypeId: SPA_TYPE_ID };
  console.log('Creating SPA item with fields:', JSON.stringify(fields, null, 2));
  const r = await b24Call('crm.item.add', params);
  if (r?.error) {
    console.error('Error creating SPA item:', r.error, r.error_description);
    return null;
  }
  const itemId = r.result;
  mapping[chatId] = itemId;
  saveMapping();
  console.log(`Created SPA item ID=${itemId} for chat ${chatId}`);
  return itemId;
}

async function addCommentToTimeline(entityTypeId, entityId, text, authorId = null) {
  const fields = {
    ENTITY_TYPE_ID: entityTypeId,
    ENTITY_ID: entityId,
    COMMENT: text
  };
  if (authorId) fields.AUTHOR_ID = authorId;
  console.log(`Adding comment to timeline: entityId=${entityId}, text="${text}"`);
  const r = await b24Call('crm.timeline.comment.add', { fields });
  if (r?.error) {
    console.error('Error adding comment:', r.error, r.error_description);
    return null;
  }
  return r.result;
}

async function getItem(entityTypeId, id) {
  const r = await b24Call('crm.item.get', { id, entityTypeId });
  return r.result;
}

function isBotComment(comment) {
  if (!comment) return false;
  if (SYSTEM_USER_ID && String(comment.AUTHOR_ID) === String(SYSTEM_USER_ID)) return true;
  if (comment.COMMENT && comment.COMMENT.includes('[BOT_MSG]')) return true;
  return false;
}

// Telegram webhook handler
app.post('/telegram/webhook', async (req, res) => {
  try {
    const update = req.body;
    const msg = update.message || update.edited_message;
    if (!msg) return res.sendStatus(200);
    const chatId = msg.chat.id;
    const text = msg.text || '<non-text message>';
    const user = msg.from;

    console.log(`Received message from Telegram: chatId=${chatId}, text="${text}"`);

    // find or create SPA item
    let itemId = await findItemByChatId(chatId);
    if (!itemId) {
      itemId = await createSpaItemFromTelegram(chatId, text, user);
      if (!itemId) {
        console.error('Failed to create SPA item for Telegram message.');
        return res.sendStatus(500);
      }
    }

    // add comment to timeline
    const commentText = `[From Telegram] ${user.first_name || user.username || user.id}:\n${text}`;
    await addCommentToTimeline(SPA_TYPE_ID, itemId, commentText);

    // reply to user
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: 'Спасибо! Ваше сообщение добавлено в заявку.'
    }).catch(e => console.warn('tg send failed', e.response?.data || e.message));

    return res.sendStatus(200);
  } catch (err) {
    console.error('telegram webhook error', err);
    return res.sendStatus(500);
  }
});

// Bitrix outbound webhook handler
app.post('/bitrix/outbound', async (req, res) => {
  try {
    const body = req.body || {};
    const comment = body?.data?.FIELDS || body?.data?.COMMENT || body?.comment || body;
    const ENTITY_ID = comment?.ENTITY_ID || comment?.entity_id || comment?.FIELDS?.ENTITY_ID;
    const ENTITY_TYPE_ID = comment?.ENTITY_TYPE_ID || comment?.entity_type_id || comment?.FIELDS?.ENTITY_TYPE_ID;
    const COMMENT_TEXT = comment?.COMMENT || comment?.comment || comment?.FIELDS?.COMMENT || '';
    const AUTHOR_ID = comment?.AUTHOR_ID || comment?.FIELDS?.AUTHOR_ID;

    if (!ENTITY_ID) {
      console.warn('No ENTITY_ID in outbound payload, ignoring.');
      return res.sendStatus(200);
    }

    if (isBotComment({ AUTHOR_ID, COMMENT: COMMENT_TEXT })) {
      return res.sendStatus(200);
    }

    const item = await getItem(ENTITY_TYPE_ID || SPA_TYPE_ID, ENTITY_ID);
    const chatId = item?.UF_CRM_TELEGRAM_CHAT_ID || item?.result?.UF_CRM_TELEGRAM_CHAT_ID || (mapping && Object.keys(mapping).find(k => mapping[k] == ENTITY_ID));
    if (!chatId) {
      console.warn('No chatId found for item', ENTITY_ID);
      return res.sendStatus(200);
    }

    const sendText = `[Ответ из Bitrix] ${COMMENT_TEXT} [BOT_MSG]`;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: sendText
    }).catch(e => console.warn('tg send error', e.response?.data || e.message));

    return res.sendStatus(200);
  } catch (err) {
    console.error('bitrix outbound handler error', err);
    return res.sendStatus(500);
  }
});

app.get('/', (req, res) => res.send('Telegram-Bitrix integration server is running.'));

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
