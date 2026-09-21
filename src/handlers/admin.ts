import { Composer, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import { Movie } from '../models/Movie';
import { User } from '../models/User';
import { SubChannel } from '../models/SubChannel';
import { Settings } from '../models/Settings';
import { getChannelId } from '../helpers/settings';

export const adminHandler = new Composer();

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getAdminIds = (): number[] => {
  const raw = process.env.ADMIN_IDS || '';
  return raw.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
};
const isAdmin = (userId: number) => getAdminIds().includes(userId);


// ─── STATE ────────────────────────────────────────────────────────────────────
type AdminState =
  | { type: 'add_waiting_code' }
  | { type: 'add_waiting_video'; code: string }
  | { type: 'broadcast_waiting_message' }
  | { type: 'autobroadcast_waiting_message' }
  | { type: 'sub_waiting_channel' }
  | { type: 'sub_waiting_link'; channelId: string; title: string; defaultLink: string }
  | { type: 'sub_waiting_check'; channelId: string; title: string; link: string }
  | { type: 'send_waiting_message'; targetId: number }
  | { type: 'settings_waiting_channel' };

const adminStates = new Map<number, AdminState>();

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────

// Bottom reply keyboard
const mainPanel = new Keyboard()
  .text('➕ Kino qo\'shish').row()
  .text('👥 Foydalanuvchilar').text('📢 Xabar yuborish').row()
  .text('🤖 Avto-Tarqatmalar').text('📋 Kinolar ro\'yxati').row()
  .text('🗑️ Kino o\'chirish').text('🔒 Majburiy obuna').row()
  .text('⚙️ Sozlamalar').text('❌ Panelni yopish')
  .resized()
  .persistent();

const backBtn = new InlineKeyboard().text('🔙 Orqaga', 'admin:back');

// ─── /admin ───────────────────────────────────────────────────────────────────
adminHandler.command('admin', async (ctx) => {
  adminStates.delete(ctx.from!.id);
  await ctx.reply('🎛 <b>Admin Panel</b>\n\nQuyidagi tugmalardan birini tanlang:', {
    parse_mode: 'HTML',
    reply_markup: mainPanel
  });
});

// ─── BROADCAST HANDLER (ANY MESSAGE TYPE) ────────────────────────────────────
adminHandler.on('message', async (ctx, next) => {
  const userId = ctx.from!.id;
  const state = adminStates.get(userId);

  const mainKeys = [
    '/admin', '❌ Panelni yopish', '🤖 Avto-Tarqatmalar',
    "➕ Kino qo'shish", '👥 Foydalanuvchilar', '📢 Xabar yuborish',
    "📋 Kinolar ro'yxati", "🗑️ Kino o'chirish", '🔒 Majburiy obuna',
    '⚙️ Sozlamalar'
  ];

  if (state?.type === 'broadcast_waiting_message') {
    const text = ctx.message.text?.trim();
    if (text && mainKeys.includes(text)) {
      await next();
      return;
    }

    adminStates.delete(userId);
    const adminIds = getAdminIds();
    const users = await User.find({ telegramId: { $nin: adminIds } });
    let sent = 0;
    const failedUsers: any[] = [];

    await ctx.reply(`📤 Xabar yuborilmoqda... (${users.length} ta foydalanuvchi)`);
    for (const user of users) {
      try {
        await ctx.api.copyMessage(user.telegramId, ctx.chat.id, ctx.message.message_id);
        sent++;
      } catch (err) {
        failedUsers.push(user);
      }
      await new Promise(r => setTimeout(r, 50));
    }
    
    let resultText = `📢 <b>Broadcast yakunlandi!</b>\n\n✅ Yuborildi: ${sent} ta\n❌ Xato: ${failedUsers.length} ta`;

    if (failedUsers.length > 0) {
      if (failedUsers.length <= 15) {
        resultText += `\n\n<b>Xato bo'lgan foydalanuvchilar:</b>\n`;
        failedUsers.forEach((u, i) => {
          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || "Noma'lum";
          const uname = u.username ? ` (@${u.username})` : '';
          resultText += `${i + 1}. <a href="tg://user?id=${u.telegramId}">${name}</a>${uname} (ID: <code>${u.telegramId}</code>)\n`;
        });
        await ctx.reply(resultText, { parse_mode: 'HTML', reply_markup: mainPanel });
      } else {
        await ctx.reply(resultText, { parse_mode: 'HTML', reply_markup: mainPanel });
        
        let fileContent = `Xato bo'lgan foydalanuvchilar ro'yxati:\n\n`;
        failedUsers.forEach((u, i) => {
          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || "Noma'lum";
          const uname = u.username ? ` (@${u.username})` : '';
          fileContent += `${i + 1}. ${name}${uname} (ID: ${u.telegramId})\n`;
        });
        
        const buffer = Buffer.from(fileContent, 'utf-8');
        const file = new InputFile(buffer, 'failed_users.txt');
        await ctx.replyWithDocument(file, { caption: "Xato bo'lganlar ro'yxati" });
      }
    } else {
      await ctx.reply(resultText, { parse_mode: 'HTML', reply_markup: mainPanel });
    }
    return;
  }

  if (state?.type === 'autobroadcast_waiting_message') {
    const text = ctx.message.text?.trim();
    if (text && mainKeys.includes(text)) {
      await next();
      return;
    }

    // Save message to auto-messages pool
    try {
      const msg = await ctx.api.copyMessage(ctx.chat.id, ctx.chat.id, ctx.message.message_id);
      
      const { AutoMessage } = await import('../models/AutoMessage');
      const autoMsg = new AutoMessage({
        messageId: msg.message_id,
        fromChatId: ctx.chat.id
      });
      await autoMsg.save();

      await ctx.reply(
        `✅ <b>Avto-xabar saqlandi!</b>\n\nUshbu xabar kuniga 3 marta avtomatik yuboriladigan xabarlar ro'yxatiga qo'shildi.`,
        { parse_mode: 'HTML', reply_markup: mainPanel }
      );
    } catch (err) {
      console.error('Avto-xabar saqlashda xatolik:', err);
      await ctx.reply('❌ Xabar saqlashda xatolik yuz berdi.', { reply_markup: mainPanel });
    }
    adminStates.delete(userId);
    return;
  }

  if (state?.type === 'send_waiting_message') {
    const text = ctx.message.text?.trim();
    if (text === '/admin' || text === '❌ Panelni yopish') {
      await next();
      return;
    }

    try {
      await ctx.api.copyMessage(state.targetId, ctx.chat.id, ctx.message.message_id);
      await ctx.reply(`✅ Xabar foydalanuvchiga muvaffaqiyatli yuborildi!`, { reply_markup: mainPanel });
    } catch (err) {
      console.error('Bitta odamga xabar yuborishda xatolik:', err);
      await ctx.reply(`❌ Xabarni yetkazish imkonsiz. Foydalanuvchi botni bloklagan bo'lishi mumkin.`, { reply_markup: mainPanel });
    }
    
    adminStates.delete(userId);
    return;
  }

  await next();
});

// ─── USER HISTORY (/user_ID) ──────────────────────────────────────────────────
adminHandler.hears(/^\/user_(\d+)$/, async (ctx) => {
  const targetId = parseInt(ctx.match[1], 10);
  try {
    const user = await User.findOne({ telegramId: targetId });
    if (!user) {
      await ctx.reply('⚠️ Foydalanuvchi topilmadi.');
      return;
    }

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || "Noma'lum";
    let text = `👤 <b>Foydalanuvchi tarixi:</b>\n\nIsmi: <b>${name}</b>\nID: <code>${user.telegramId}</code>\nJami ko'rgan kinolari: <b>${user.history?.length || 0} ta</b>\n\n`;

    if (user.history && user.history.length > 0) {
      // Sort by watchedAt descending, limit to last 50 for safety
      const history = [...user.history].sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime()).slice(0, 50);
      history.forEach((h, i) => {
        const date = new Date(h.watchedAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
        text += `${i + 1}. Kod: <code>${h.movieCode}</code> — 🕐 ${date}\n`;
      });
      if (user.history.length > 50) {
        text += `\n<i>Va yana ${user.history.length - 50} ta kino ko'rgan. Ro'yxatda faqat oxirgi 50 tasi ko'rsatildi.</i>`;
      }
    } else {
      text += '<i>Hali hech qanday kino ko\'rmagan.</i>';
    }

    const keyboard = new InlineKeyboard()
      .text('✍️ Xabar yuborish', `admin:msg_user:${user.telegramId}`);

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (err) {
    console.error('User history error:', err);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
});

// ─── REPLY KEYBOARD BUTTON HANDLERS ──────────────────────────────────────────

const handleAddButton = async (ctx: any) => {
  adminStates.set(ctx.from.id, { type: 'add_waiting_code' });
  await ctx.reply(
    '➕ <b>Kino qo\'shish</b>\n\nKino kodini yuboring (masalan: <code>001</code>):\n\n❌ Bekor qilish uchun /admin yozing',
    { parse_mode: 'HTML' }
  );
};

const buildUsersPanel = async (page: number) => {
  const limit = 50;
  const skip = page * limit;
  const total = await User.countDocuments();
  const users = await User.find().sort({ joinedAt: -1 }).skip(skip).limit(limit);
  
  let text = `👥 <b>Foydalanuvchilar ro'yxati</b>\n\n📊 Jami: <b>${total} ta</b>\n📄 Sahifa: <b>${page + 1}</b>\n\n`;
  
  users.forEach((u, i) => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || "Noma'lum";
    const uname = u.username ? ` (@${u.username})` : '';
    const count = u.history ? u.history.length : 0;
    text += `${skip + i + 1}. <a href="tg://user?id=${u.telegramId}">${name}</a>${uname} — 👁 <b>${count}</b> ta kino /user_${u.telegramId}\n`;
  });

  const keyboard = new InlineKeyboard();
  if (page > 0) {
    keyboard.text('⬅️ Oldingi', `admin:users_page:${page - 1}`);
  }
  if (skip + limit < total) {
    keyboard.text('Keyingi ➡️', `admin:users_page:${page + 1}`);
  }
  
  return { text, keyboard };
};

const handleUsersButton = async (ctx: any) => {
  try {
    const { text, keyboard } = await buildUsersPanel(0);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
};

const handleBroadcastButton = async (ctx: any) => {
  adminStates.set(ctx.from.id, { type: 'broadcast_waiting_message' });
  await ctx.reply(
    '📢 <b>Barcha foydalanuvchilarga xabar yuborish</b>\n\nYubormoqchi bo\'lgan xabaringizni yozing:\n\n❌ Bekor qilish uchun /admin yozing',
    { parse_mode: 'HTML' }
  );
};

const handleAutoBroadcastButton = async (ctx: any) => {
  adminStates.set(ctx.from.id, { type: 'autobroadcast_waiting_message' });
  
  const { AutoMessage } = await import('../models/AutoMessage');
  const count = await AutoMessage.countDocuments();
  
  const keyboard = new InlineKeyboard()
    .text('🗑 Barchasini tozalash', 'admin:clear_autobroadcast');

  await ctx.reply(
    `🤖 <b>Avto-Tarqatmalar</b>\n\nBazada jami <b>${count}</b> ta avto-xabar mavjud.\n\nYangi xabar qo'shish uchun uni shu yerga yuboring (rasm, video yoki matn bo'lishi mumkin).\n\n<i>Avto-xabarlar har kuni soat 10:00, 15:00 va 20:00 da hammaga tarqatiladi.</i>\n\n❌ Bekor qilish uchun tugmalardan birini bosing.`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
};

const handleListButton = async (ctx: any) => {
  try {
    const movies = await Movie.find().sort({ addedAt: -1 }).limit(50);
    if (movies.length === 0) {
      await ctx.reply('📋 Kinolar ro\'yxati bo\'sh.');
      return;
    }
    let text = `📋 <b>Kinolar ro'yxati (${movies.length} ta):</b>\n\n`;
    movies.forEach((m: any, i: number) => {
      text += `${i + 1}. <code>${m.code}</code> — ${m.title ?? '—'}${m.year ? ` (${m.year})` : ''}\n`;
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
};

const buildDeletePanel = async () => {
  const movies = await Movie.find().sort({ addedAt: -1 }).limit(50);
  const keyboard = new InlineKeyboard();

  if (movies.length === 0) {
    keyboard.text('🔙 Orqaga', 'admin:back');
    return { text: '🗑️ <b>Kino o\'chirish</b>\n\nBazada hech qanday kino topilmadi.', keyboard };
  }

  movies.forEach((m, index) => {
    keyboard.text(`❌ ${m.code}`, `admin:del_movie:${m._id}`);
    if ((index + 1) % 3 === 0) {
      keyboard.row();
    }
  });
  
  if (movies.length % 3 !== 0) {
    keyboard.row();
  }
  keyboard.text('🔙 Orqaga', 'admin:back');

  return {
    text: `🗑️ <b>Kino o'chirish</b>\n\nO'chirmoqchi bo'lgan kinoni tanlang (Oxirgi 50 ta ko'rsatilgan):`,
    keyboard
  };
};

const handleDeleteButton = async (ctx: any) => {
  const { text, keyboard } = await buildDeletePanel();
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
};

const handleSubButton = async (ctx: any) => {
  const { text, keyboard } = await buildSubPanel();
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
};

const handleSettingsButton = async (ctx: any) => {
  const currentChannelId = await getChannelId();
  const keyboard = new InlineKeyboard()
    .text('📡 Kanal ulash / o\'zgartirish', 'admin:settings_set_channel').row();
  if (currentChannelId) {
    keyboard.text('🗑️ Kanalni o\'chirish', 'admin:settings_remove_channel').row();
  }

  const channelText = currentChannelId
    ? `✅ Ulangan kanal: <code>${currentChannelId}</code>`
    : '⚠️ Hech qanday kanal ulanmagan.';

  await ctx.reply(
    `⚙️ <b>Sozlamalar</b>\n\n📡 <b>Kino kanali:</b>\n${channelText}\n\nKinolar shu kanaldan forward qilinadi.`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
};

const handleCloseButton = async (ctx: any) => {
  adminStates.delete(ctx.from.id);
  await ctx.reply('✅ Panel yopildi.', {
    reply_markup: { remove_keyboard: true }
  });
};

// ─── CALLBACK QUERIES ─────────────────────────────────────────────────────────

adminHandler.callbackQuery('admin:back', async (ctx) => {
  await ctx.answerCallbackQuery();
  adminStates.delete(ctx.from.id);
  await ctx.deleteMessage();
  await ctx.reply('🎛 <b>Admin Panel</b>\n\nQuyidagi tugmalardan birini tanlang:', {
    parse_mode: 'HTML',
    reply_markup: mainPanel
  });
});

// ─── ⚙️ SOZLAMALAR CALLBACKS ──────────────────────────────────────────────────

adminHandler.callbackQuery('admin:settings_set_channel', async (ctx) => {
  await ctx.answerCallbackQuery();
  adminStates.set(ctx.from.id, { type: 'settings_waiting_channel' });
  await ctx.editMessageText(
    '📡 <b>Kino kanalini ulash</b>\n\nKanal username yoki ID sini yuboring:\n\n📌 Misol:\n<code>@mening_kino_kanal</code>\n<code>-1001234567890</code>\n\n⚠️ Agar kanal yopiq (private) bo\'lsa, uning ID sini kiritishingiz kerak. ID ni bilish uchun kanal xabarini @userinfobot ga yuboring.\n\n❌ Diqqat: Invite link (https://t.me/...) qabul qilinmaydi!\n\n⚠️ Bot shu kanalda <b>admin</b> bo\'lishi shart!\n\n❌ Bekor qilish uchun /admin yozing',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Orqaga', 'admin:back') }
  );
});

adminHandler.callbackQuery('admin:settings_remove_channel', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await Settings.deleteOne({ key: 'channel_id' });
    await ctx.editMessageText(
      '✅ Kanal o\'chirildi.\n\n⚙️ <b>Sozlamalar</b>\n\n📡 Kino kanali: ⚠️ Hech qanday kanal ulanmagan.',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('📡 Kanal ulash', 'admin:settings_set_channel').row()
          .text('🔙 Orqaga', 'admin:back')
      }
    );
  } catch (err) {
    console.error(err);
    await ctx.answerCallbackQuery('❌ Xatolik yuz berdi');
  }
});

// ─── 🔒 MAJBURIY OBUNA ────────────────────────────────────────────────────────

const buildSubPanel = async () => {
  const channels = await SubChannel.find().sort({ addedAt: -1 });
  const keyboard = new InlineKeyboard();

  if (channels.length === 0) {
    keyboard.text('➕ Kanal qo\'shish', 'admin:sub_add').row();
  } else {
    channels.forEach(ch => {
      keyboard
        .url(`📢 ${ch.title}`, ch.link)
        .text('🗑', `admin:sub_remove:${ch._id}`)
        .row();
    });
    keyboard.text('➕ Kanal qo\'shish', 'admin:sub_add').row();
  }

  let text = `🔒 <b>Majburiy obuna kanallari</b>\n\n`;
  if (channels.length === 0) {
    text += '⚠️ Hozircha hech qanday kanal qo\'shilmagan.';
  } else {
    text += `Jami: <b>${channels.length} ta kanal</b>\n\n`;
    channels.forEach((ch, i) => {
      text += `${i + 1}. ${ch.title} — <code>${ch.channelId}</code>\n`;
    });
    text += '\n🗑 tugmasi — kanalini o\'chirish';
  }

  return { text, keyboard };
};

adminHandler.callbackQuery('admin:sub_add', async (ctx) => {
  await ctx.answerCallbackQuery();
  adminStates.set(ctx.from.id, { type: 'sub_waiting_channel' });
  await ctx.editMessageText(
    '🔒 <b>Kanal qo\'shish</b>\n\nKanal username yoki ID sini yuboring:\n\n📌 Misol:\n<code>@mening_kanalim</code>\n<code>-1001234567890</code>\n\n⚠️ Agar kanal yopiq bo\'lsa, ID sini kiritishingiz kerak. ID ni bilish uchun kanal xabarini @userinfobot ga yuboring.\n\n❌ Diqqat: Invite link (https://t.me/...) qabul qilinmaydi!\n\n⚠️ Bot shu kanalda <b>admin</b> bo\'lishi shart!\n\n❌ Bekor qilish uchun /admin yozing',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Orqaga', 'admin:back') }
  );
});

adminHandler.callbackQuery(/^admin:sub_check:(yes|no)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from.id;
  const state = adminStates.get(userId);
  if (state?.type !== 'sub_waiting_check') {
    await ctx.editMessageText('❌ Amaliyot muddati tugagan.', { reply_markup: backBtn });
    return;
  }
  adminStates.delete(userId);

  const skipCheck = ctx.match[1] === 'no';
  try {
    await SubChannel.findOneAndUpdate(
      { channelId: state.channelId },
      { channelId: state.channelId, title: state.title, link: state.link, skipCheck },
      { upsert: true, new: true }
    );

    const { text: panelText, keyboard } = await buildSubPanel();
    await ctx.editMessageText(
      `✅ <b>${state.title}</b> kanali/boti muvaffaqiyatli qo'shildi!\n\n` + panelText,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (err) {
    console.error(err);
    await ctx.editMessageText('❌ Saqlashda xatolik yuz berdi.');
  }
});

adminHandler.callbackQuery(/^admin:sub_remove:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const mongoId = ctx.match[1];
  try {
    const removed = await SubChannel.findByIdAndDelete(mongoId);
    if (removed) {
      const { text, keyboard } = await buildSubPanel();
      await ctx.editMessageText(
        `✅ <b>${removed.title}</b> kanali o'chirildi!\n\n` + text,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }
  } catch (err) {
    console.error(err);
    await ctx.answerCallbackQuery('❌ Xatolik yuz berdi');
  }
});

adminHandler.callbackQuery(/^admin:del_movie:(.+)$/, async (ctx) => {
  const mongoId = ctx.match[1];
  try {
    const removed = await Movie.findByIdAndDelete(mongoId);
    if (removed) {
      await ctx.answerCallbackQuery(`✅ ${removed.code} o'chirildi!`);
      const { text, keyboard } = await buildDeletePanel();
      await ctx.editMessageText(
        `✅ <b>Kino o'chirildi!</b> (Kod: <code>${removed.code}</code>)\n\n` + text,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } else {
      await ctx.answerCallbackQuery('⚠️ Kino topilmadi.');
    }
  } catch (err) {
    console.error(err);
    await ctx.answerCallbackQuery('❌ O\'chirishda xatolik yuz berdi');
  }
});

adminHandler.callbackQuery(/^admin:users_page:(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10);
  try {
    const { text, keyboard } = await buildUsersPanel(page);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (err) {
    console.error(err);
    await ctx.answerCallbackQuery('❌ Xatolik yuz berdi');
  }
});

adminHandler.callbackQuery(/^admin:msg_user:(\d+)$/, async (ctx) => {
  const targetId = parseInt(ctx.match[1], 10);
  adminStates.set(ctx.from.id, { type: 'send_waiting_message', targetId });
  await ctx.answerCallbackQuery();
  await ctx.reply(`✍️ <b>ID: ${targetId} ga xabar yuborish</b>\n\nYubormoqchi bo'lgan xabaringizni yozing (rasm, video yoki matn).\n\n❌ Bekor qilish uchun /admin yozing`, { parse_mode: 'HTML' });
});

adminHandler.callbackQuery('admin:clear_autobroadcast', async (ctx) => {
  const { AutoMessage } = await import('../models/AutoMessage');
  await AutoMessage.deleteMany({});
  await ctx.answerCallbackQuery("✅ Barcha avto-tarqatmalar o'chirildi!");
  await ctx.editMessageText("✅ <b>Barcha avto-tarqatmalar o'chirildi!</b>\n\nEndi baza bo'sh. Yangi xabar qo'shishingiz mumkin.", { parse_mode: 'HTML' });
});

// ─── TEXT MESSAGE HANDLER ─────────────────────────────────────────────────────
adminHandler.on('message:text', async (ctx, next) => {
  const userId = ctx.from!.id;
  const text = ctx.message.text.trim();
  const state = adminStates.get(userId);

  // --- Bottom keyboard button presses ---
  if (!state) {
    if (text === '➕ Kino qo\'shish')       { await handleAddButton(ctx); return; }
    if (text === '👥 Foydalanuvchilar')      { await handleUsersButton(ctx); return; }
    if (text === '📢 Xabar yuborish')        { await handleBroadcastButton(ctx); return; }
    if (text === '🤖 Avto-Tarqatmalar')      { await handleAutoBroadcastButton(ctx); return; }
    if (text === '📋 Kinolar ro\'yxati')     { await handleListButton(ctx); return; }
    if (text === '🗑️ Kino o\'chirish')       { await handleDeleteButton(ctx); return; }
    if (text === '🔒 Majburiy obuna')        { await handleSubButton(ctx); return; }
    if (text === '⚙️ Sozlamalar')            { await handleSettingsButton(ctx); return; }
    if (text === '❌ Panelni yopish')        { await handleCloseButton(ctx); return; }

    // No button match and no state — pass to userHandler
    await next();
    return;
  }

  // --- Add: waiting for code ---
  if (state.type === 'add_waiting_code') {
    const code = text;
    const existing = await Movie.findOne({ code });
    if (existing) {
      await ctx.reply(`⚠️ <b>${code}</b> kodi bilan kino allaqachon mavjud. Iltimos, boshqa kod yuboring:\n\n❌ Bekor qilish uchun /admin yozing`, { parse_mode: 'HTML' });
      return;
    }
    adminStates.set(userId, { type: 'add_waiting_video', code });
    await ctx.reply(
      `🎥 <b>Kino videosini yuboring</b>\n\nKino kodi: <code>${code}</code>\n\nEndi kino videosini yuboring. Kino nomi va boshqa ma'lumotlari video tagida (caption) bo'lishi kerak. Ular foydalanuvchiga video bilan birga yuboriladi.\n\n❌ Bekor qilish uchun /admin yozing`,
      { parse_mode: 'HTML' }
    );
    return;
  }





  // --- Settings: waiting for channel ---
  if (state.type === 'settings_waiting_channel') {
    adminStates.delete(userId);
    
    if (text.includes('t.me/')) {
      await ctx.reply('❌ Noto\'g\'ri format. Iltimos, kanal <b>username</b> (<code>@kanal</code>) yoki <b>ID</b> (<code>-100...</code>) sini yuboring.\n\nInvite link (ssilka) qabul qilinmaydi. Yopiq kanal ID sini bilish uchun kanaldagi biror xabarni @userinfobot ga yuborib ko\'ring.', { parse_mode: 'HTML', reply_markup: mainPanel });
      return;
    }

    try {
      const chat = await ctx.api.getChat(text) as any;
      const channelId = String(chat.id);
      const title = chat.title || chat.username || text;

      await Settings.findOneAndUpdate(
        { key: 'channel_id' },
        { key: 'channel_id', value: channelId },
        { upsert: true, new: true }
      );

      await ctx.reply(
        `✅ Kanal muvaffaqiyatli ulandi!\n\n📡 Kanal: <b>${title}</b>\n🆔 ID: <code>${channelId}</code>\n\nEndi kinolar shu kanaldan forward qilinadi.`,
        { parse_mode: 'HTML', reply_markup: mainPanel }
      );
    } catch (err) {
      console.error(err);
      await ctx.reply(
        '❌ Kanal topilmadi yoki bot kanalda admin emas.\n\nBotni kanalga admin qilib, qaytadan urinib ko\'ring.',
        { reply_markup: mainPanel }
      );
    }
    return;
  }

  // --- Subscription: waiting for channel ---
  if (state.type === 'sub_waiting_channel') {
    adminStates.delete(userId);

    if (text.includes('t.me/')) {
      await ctx.reply('❌ Noto\'g\'ri format. Iltimos, kanal <b>username</b> (<code>@kanal</code>) yoki <b>ID</b> (<code>-100...</code>) sini yuboring.\n\nInvite link (ssilka) qabul qilinmaydi. Yopiq kanal ID sini bilish uchun kanaldagi biror xabarni @userinfobot ga yuborib ko\'ring.', { parse_mode: 'HTML', reply_markup: mainPanel });
      return;
    }

    try {
      const chat = await ctx.api.getChat(text) as any;
      const channelId = String(chat.id);
      const title = chat.title || chat.username || text;
      const username = chat.username;
      
      let defaultLink = '';
      if (username) {
        defaultLink = `https://t.me/${username}`;
      } else {
        try {
          defaultLink = await ctx.api.exportChatInviteLink(channelId);
        } catch {
          defaultLink = `https://t.me/c/${channelId.replace('-100', '')}`;
        }
      }

      adminStates.set(userId, { type: 'sub_waiting_link', channelId, title, defaultLink });
      
      await ctx.reply(
        `✅ <b>${title}</b> kanali topildi.\n\nFoydalanuvchilarga ushbu kanal uchun qanday silka (tugma) ko'rsatilsin?\n\nZayavka yoki maxsus silka bo'lsa, uni yuboring. Aks holda <b>/skip</b> buyrug'ini yozing (avtomatik silka o'rnatiladi).`,
        { parse_mode: 'HTML', reply_markup: mainPanel }
      );
    } catch (err) {
      console.error(err);
      await ctx.reply(
        '❌ Kanal topilmadi yoki bot kanalda admin emas.\n\nBotni kanalga admin qilib, qaytadan urinib ko\'ring.',
        { reply_markup: mainPanel }
      );
    }
    return;
  }

  // --- Subscription: waiting for link ---
  if (state.type === 'sub_waiting_link') {
    adminStates.delete(userId);
    let finalLink = state.defaultLink;
    
    if (text !== '/skip') {
      if (!text.startsWith('http://') && !text.startsWith('https://')) {
        await ctx.reply('❌ Noto\'g\'ri format. Silka http yoki https bilan boshlanishi kerak. Boshqatdan urinib ko\'ring.', { reply_markup: mainPanel });
        return;
      }
      finalLink = text;
    }
    
    adminStates.set(userId, { type: 'sub_waiting_check', channelId: state.channelId, title: state.title, link: finalLink });
    
    const kb = new InlineKeyboard()
      .text('✅ Ha (Qat\'iy tekshirish)', 'admin:sub_check:yes').row()
      .text('❌ Yo\'q (Faqat silkani bosish kifoya)', 'admin:sub_check:no');

    await ctx.reply(
      `❓ <b>${state.title}</b> bot/kanaliga a'zolik qat'iy tekshirilsinmi?\n\n(Agar bu BOT bo'lsa, "Yo'q" tugmasini bosing, chunki bot obunasini Telegram orqali tekshirib bo'lmaydi!)`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  // Fallback
  await next();
});

// ─── VIDEO HANDLER ────────────────────────────────────────────────────────────
adminHandler.on('message:video', async (ctx, next) => {
  const userId = ctx.from!.id;
  const state = adminStates.get(userId);
  const msg = ctx.message;
  const video = msg.video;

  // ── Case 1: Forward from channel — auto-index using caption ──────────────
  const msgAny = msg as any;
  if (!state && (msgAny.forward_origin || msgAny.forward_from_chat || msgAny.forward_date)) {
    const rawCaption = msg.caption || '';
    const lines = rawCaption.split('\n').map((l: string) => l.trim()).filter(Boolean);

    if (lines.length === 0) {
      await ctx.reply('⚠️ Forward qilingan videoda caption (kod) yo\'q. Kino saqlanmadi.', { reply_markup: mainPanel });
      return;
    }

    const code = lines[0];
    const title = lines[1] || undefined;
    let year: number | undefined;
    let descLines: string[] = [];

    if (lines[2] && /^\d{4}$/.test(lines[2])) {
      year = parseInt(lines[2]);
      descLines = lines.slice(3);
    } else {
      descLines = lines.slice(2);
    }

    const caption = descLines.join('\n') || undefined;
    const fileId = video.file_id;
    const forwardChatId = msgAny.forward_from_chat?.id;
    const messageId = msgAny.forward_from_message_id || msg.message_id;

    try {
      await Movie.findOneAndUpdate(
        { code },
        { code, title, year, caption, fileId, messageId, channelId: forwardChatId || undefined },
        { upsert: true, new: true }
      );
      await ctx.reply(
        `✅ <b>Kino saqlandi!</b>\n\n📌 Kod: <code>${code}</code>\n🎬 Nomi: <b>${title ?? '—'}</b>${year ? `\n📅 Yil: ${year}` : ''}`,
        { parse_mode: 'HTML', reply_markup: mainPanel }
      );
    } catch (err: any) {
      if (err.code === 11000) {
        await ctx.reply(`⚠️ <b>${code}</b> kodli kino yangilandi!`, { parse_mode: 'HTML', reply_markup: mainPanel });
      } else {
        console.error(err);
        await ctx.reply('❌ Saqlashda xatolik yuz berdi.', { reply_markup: mainPanel });
      }
    }
    return;
  }

  // ── Case 2: Waiting for video after adding code ─────────────────────────
  if (state?.type !== 'add_waiting_video') {
    await next();
    return;
  }

  adminStates.delete(userId);
  const fileId = video.file_id;
  
  const caption = msg.caption || `📺Ushbu videoni to'ligʻini botga joyladik bot orqali yuklab olishingiz mumkin❗️🔞🔞🔞🔞🔞🔞🔞

🔢 Kino kodi: ${state.code}

📍Bot manzili: @UzFilmchi_bot
                    
⚡️⚡️⚡️⚡️⚡️⚡️⚡️⚡️720hd
🔥LIKE BOSING zoʻrlari chiqadi✔️`;

  try {
    const movie = new Movie({
      code: state.code,
      fileId,
      caption
    });
    await movie.save();
    await ctx.reply(
      `✅ <b>Kino qo'shildi!</b>\n\n📌 Kod: <code>${state.code}</code>\n📝 Tagidagi yozuv: ${caption ? '\n' + caption : 'yo\'q'}`,
      { parse_mode: 'HTML', reply_markup: mainPanel }
    );
  } catch (err: any) {
    if (err.code === 11000) {
      await ctx.reply(`❌ <b>${state.code}</b> kodi bilan kino allaqachon mavjud!`, {
        parse_mode: 'HTML', reply_markup: mainPanel
      });
    } else {
      console.error(err);
      await ctx.reply('❌ Saqlashda xatolik yuz berdi.', { reply_markup: mainPanel });
    }
  }
});

// ─── COMMANDS ─────────────────────────────────────────────────────────────────

adminHandler.command('add', async (ctx) => {
  adminStates.set(ctx.from!.id, { type: 'add_waiting_code' });
  await ctx.reply(
    '➕ <b>Kino qo\'shish</b>\n\nKino kodini yuboring (masalan: <code>001</code>):\n\n❌ Bekor qilish uchun /admin yozing',
    { parse_mode: 'HTML' }
  );
});

adminHandler.command('delete', async (ctx) => {
  const code = ctx.match?.trim();
  if (!code) {
    await ctx.reply('❌ Format: <code>/delete [kod]</code>', { parse_mode: 'HTML' });
    return;
  }
  try {
    const result = await Movie.findOneAndDelete({ code });
    if (result) {
      await ctx.reply(`✅ <b>${code}</b> — "${result.title ?? 'Nomsiz'}" o'chirildi!`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(`❌ <b>${code}</b> kodli kino topilmadi.`, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
});

adminHandler.command('list', async (ctx) => {
  try {
    const movies = await Movie.find().sort({ addedAt: -1 }).limit(50);
    if (movies.length === 0) {
      await ctx.reply('📋 Kinolar ro\'yxati bo\'sh.');
      return;
    }
    let text = `📋 <b>Kinolar ro'yxati (${movies.length} ta):</b>\n\n`;
    movies.forEach((m, i) => {
      text += `${i + 1}. <code>${m.code}</code> — ${m.title ?? '—'}${m.year ? ` (${m.year})` : ''}\n`;
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
});
