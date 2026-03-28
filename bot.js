const {
  Client, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionsBitField, Events, EmbedBuilder,
} = require('discord.js');
const http = require('http');

// ─── RAILWAY KEEP-ALIVE ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot is alive ✅'); })
  .listen(PORT, () => console.log(`🌐 Keep-alive on port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN: process.env.DISCORD_TOKEN,
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID,
  EVENT_CHANNEL_ID: process.env.EVENT_CHANNEL_ID,
  EVENT_BANNER_URL: process.env.EVENT_BANNER_URL ?? null,
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID ?? null,
  PREFIX: '!',
  SWEEP_LINK_THRESHOLD: 1000,
  SWEEP_AMOUNT: 100,
  SWEEP_MIN_USES: 3,
};

if (!CONFIG.TOKEN) { console.error('❌ DISCORD_TOKEN missing.'); process.exit(1); }

// ─── RUNTIME SETTINGS ────────────────────────────────────────────────────────
const settings = {
  welcomeChannelId: CONFIG.WELCOME_CHANNEL_ID,
  welcomeMessage: "Welcome",   // Default message
  rulesChannelId: null,
  generalChannelId: null,
  eventChannelId: CONFIG.EVENT_CHANNEL_ID,
  logChannelId: null,
};

// ─── INVITE TRACKING ─────────────────────────────────────────────────────────
const inviteCache = new Map();
const inviterStats = new Map();
const lastSweepAt = new Map();

function trackInviter(guildId, userId) {
  if (!inviterStats.has(guildId)) inviterStats.set(guildId, new Map());
  const m = inviterStats.get(guildId);
  m.set(userId, (m.get(userId) ?? 0) + 1);
}

// ─── LOG BUFFER ───────────────────────────────────────────────────────────────
const logBuffer = [];

function addLog(type, description) {
  logBuffer.push({ time: Date.now(), type, description });
  if (logBuffer.length > 50) logBuffer.shift();
}

// ─── SEND TO LOG CHANNEL ─────────────────────────────────────────────────────
async function sendLog(guild, content) {
  if (!settings.logChannelId) return;
  const ch = guild.channels.cache.get(settings.logChannelId);
  if (!ch) return;
  if (typeof content === 'string') {
    await ch.send(content).catch(console.error);
  } else {
    await ch.send({ embeds: [content] }).catch(console.error);
  }
}

// ─── PERMISSION CHECK ─────────────────────────────────────────────────────────
function memberIsAdmin(member) {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (CONFIG.ADMIN_ROLE_ID && member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) return true;
  return false;
}

// ─── WIZARD STATE ────────────────────────────────────────────────────────────
const wizards = new Map();

// ── Welcome Wizard (Channel + Custom Message) ───────────────────────────────
const WELCOME_STEPS = [
  {
    key: 'welcomeChannelId',
    label: 'Welcome Channel',
    prompt: '📌 **Step 1/3 — Welcome Channel**\nMention or paste the channel ID.',
    parse: v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key: 'welcomeMessage',
    label: 'Welcome Message',
    prompt: '📝 **Step 2/3 — Welcome Message**\nWhat should the bot say?\nUse `{user}` for mention.\nExample: `Welcome` or `Hey {user}, welcome!`',
    parse: v => v.trim(),
  },
  {
    key: '_preview',
    label: 'Confirm',
    prompt: '👀 **Step 3/3 — Confirm**\nReply `confirm` to save or `cancel` to discard.',
    parse: v => v.trim().toLowerCase(),
    isConfirm: true,
  },
];

const EVENT_STEPS = [
  {
    key: 'eventChannelId', label: 'Event Channel',
    prompt: '📌 **Step 1/2 — Event Channel**\nMention or paste the channel ID.',
    parse: v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key: '_preview', label: 'Confirm',
    prompt: '👀 **Step 2/2 — Ready!**\nReply `confirm` to post or `cancel`.',
    parse: v => v.trim().toLowerCase(),
    isConfirm: true,
  },
];

// ─── EVENT COMPONENTS (keep your original function here) ─────────────────────
async function postEventComponents(channel) {
  // Paste your full original postEventComponents code here
  // (the one with Summer BloxFruit Event)
}

// ─── WIZARD STATUS EMBED ──────────────────────────────────────────────────────
function wizardStatusEmbed(steps, currentStep, data, type) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🛠️ ${type} Setup Wizard`)
    .setDescription(`Step **${currentStep + 1}** of **${steps.length}** — type \`cancel\` anytime.`)
    .addFields(
      steps.filter(s => s.key !== '_preview').map(s => ({
        name: s.label,
        value: data[s.key] ? String(data[s.key]).slice(0, 80) : '⏳ pending',
        inline: true,
      }))
    )
    .setFooter({ text: 'respond in this channel to continue' });
}

// ─── AUTO-REVOKE SWEEP (keep your original) ──────────────────────────────────
async function sweepDeadInvites(guild) {
  // Paste your original sweepDeadInvites function here
}

// ─── READY EVENT ─────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      const inv = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(inv.map(i => [i.code, i.uses])));
    } catch {}
  }
});

// ─── INVITE CREATE / DELETE (keep all your original code here) ───────────────
// Paste your InviteCreate, InviteDelete, and sweep logic

// ─── MEMBER JOIN — Simple Welcome ───────────────────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;
  const wCh = guild.channels.cache.get(settings.welcomeChannelId);
  if (!wCh) return;

  let usedInvite = null;
  try {
    const fresh = await guild.invites.fetch();
    const oldCache = inviteCache.get(guild.id) ?? new Map();
    for (const inv of fresh.values()) {
      if (inv.uses > (oldCache.get(inv.code) ?? 0)) { usedInvite = inv; break; }
    }
    inviteCache.set(guild.id, new Map(fresh.map(i => [i.code, i.uses])));
    if (usedInvite?.inviter) trackInviter(guild.id, usedInvite.inviter.id);
  } catch (err) { console.error('Invite tracking:', err); }

  let welcomeText = settings.welcomeMessage || "Welcome";
  welcomeText = welcomeText.replace(/\{user\}/g, `<@${member.id}>`);

  const welcomeMsg = await wCh.send(welcomeText);

  // Auto delete after 4 seconds
  setTimeout(() => welcomeMsg.delete().catch(() => {}), 4000);
});

// ─── BUTTONS (unchanged) ─────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'rules_btn')
    return interaction.reply({ content: settings.rulesChannelId ? `📜 <#${settings.rulesChannelId}>` : '📜 Check the rules channel!', ephemeral: true });
  if (interaction.customId === 'events_btn')
    return interaction.reply({ content: settings.eventChannelId ? `🎁 <#${settings.eventChannelId}>` : '🎁 Check the events channel!', ephemeral: true });
  if (interaction.customId === 'p_284704454815518723')
    return interaction.reply({ content: '📖 **How to invite:**\n1. Server Settings → Invites\n2. Create a link\n3. Share it\n4. Hit your goal, then contact staff to claim!', ephemeral: true });
});

// ─── MESSAGE CREATE — Fixed Order ────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // 1. Wizard handling first (only if active)
  const wizard = wizards.get(message.author.id);
  if (wizard && message.channel.id === wizard.channelId) {
    const steps = wizard.type === 'welcome' ? WELCOME_STEPS : EVENT_STEPS;
    const step = steps[wizard.step];

    if (message.content.trim().toLowerCase() === 'cancel') {
      wizards.delete(message.author.id);
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Cancelled').setDescription('Nothing was saved.').setTimestamp()] });
    }

    if (step.isConfirm) {
      if (step.parse(message.content) !== 'confirm') {
        wizards.delete(message.author.id);
        return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Cancelled').setDescription('Nothing was saved.').setTimestamp()] });
      }
      Object.assign(settings, wizard.data);
      wizards.delete(message.author.id);
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Settings saved!').setTimestamp()] });
    }

    const parsed = step.parse(message.content);
    if (parsed) wizard.data[step.key] = parsed;

    wizard.step++;
    const next = steps[wizard.step];
    if (!next) {
      wizards.delete(message.author.id);
      return;
    }

    return message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x5865F2).setDescription(next.prompt),
      wizardStatusEmbed(steps, wizard.step, { ...settings, ...wizard.data }, wizard.type === 'welcome' ? 'Welcome' : 'Event')
    ]});
  }

  // 2. Normal prefix commands (now reachable)
  if (!message.content.startsWith(CONFIG.PREFIX)) return;

  const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (!memberIsAdmin(message.member))
    return message.reply('❌ You need **Administrator** permission' + (CONFIG.ADMIN_ROLE_ID ? ' or the admin role' : '') + '.');

  // ── !setwelcome ────────────────────────────────────────────────────────────
  if (cmd === 'setwelcome') {
    if (wizards.has(message.author.id)) return message.reply('⚠️ You have an active wizard. Type `cancel` first.');
    wizards.set(message.author.id, { type: 'welcome', step: 0, data: {}, channelId: message.channel.id });
    return message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x5865F2).setTitle('🛠️ Welcome Setup').setDescription(WELCOME_STEPS[0].prompt),
      wizardStatusEmbed(WELCOME_STEPS, 0, settings, 'Welcome')
    ]});
  }

  // Paste all your other commands here (!setevent, !setlog, !logs, !revoke, !invites, !invitelb, !counts, !help, !test)
  // They will now work again.

});

client.login(CONFIG.TOKEN);
