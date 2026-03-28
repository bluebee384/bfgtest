const {
  Client, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionsBitField, Events, EmbedBuilder,
} = require('discord.js');
const http = require('http');

// RAILWAY KEEP-ALIVE
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

// CONFIG
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

// RUNTIME SETTINGS
const settings = {
  welcomeChannelId: CONFIG.WELCOME_CHANNEL_ID,
  welcomeMessage: "Welcome",
  rulesChannelId: null,
  generalChannelId: null,
  eventChannelId: CONFIG.EVENT_CHANNEL_ID,
  logChannelId: null,
};

// INVITE TRACKING
const inviteCache = new Map();
const inviterStats = new Map();
const lastSweepAt = new Map();

function trackInviter(guildId, userId) {
  if (!inviterStats.has(guildId)) inviterStats.set(guildId, new Map());
  const m = inviterStats.get(guildId);
  m.set(userId, (m.get(userId) ?? 0) + 1);
}

// LOG BUFFER
const logBuffer = [];

function addLog(type, description) {
  logBuffer.push({ time: Date.now(), type, description });
  if (logBuffer.length > 50) logBuffer.shift();
}

// SEND TO LOG CHANNEL
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

// PERMISSION CHECK
function memberIsAdmin(member) {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (CONFIG.ADMIN_ROLE_ID && member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) return true;
  return false;
}

// WIZARD STATE
const wizards = new Map();

// WELCOME WIZARD
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

// EVENT COMPONENTS
async function postEventComponents(channel) {
  const innerComponents = [
    { type: 10, content: '<:buddha:1487034693651267664> Summer BloxFruit Event — Event Rewards' },
  ];
  if (CONFIG.EVENT_BANNER_URL) {
    innerComponents.push({ type: 12, items: [{ media: { url: CONFIG.EVENT_BANNER_URL } }] });
  }
  innerComponents.push(
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: "<a:announce:1487055874521567272> To celebrate the games activity, we've launched an OFFICIAL EVENT where you can earn FREE Permanent fruits & Robux!\n<a:flowignsand:1487055896243736658> This is a `limited-time` event and comes to an end <t:1774852200:R> ( <t:1774852200:f> ), so be sure to not miss this opportunity! <a:RobuxANIM:1487057805528666285>" },
    { type: 14, divider: true, spacing: 2 },
    { type: 10, content: '<:1442164148908851220:1487058441800519680> __ EVENT REWARDS:__ <:1442164148908851220:1487058441800519680>\n> <:e_fc7201_0280:1487162459805716581> <@&1487126325536886914> <:e_fc7201_8100:1487165177009934346> Permanent Yeti <:Yeti:1487166315729780836> / 2,500 Robux <:e_fc7201_3444:1487166961212330205>\n> <:e_f5e50c_6532:1487162569901736037> <@&1487126326749040893> <:e_f5e50c_7750:1487165218298663014> Permanent Kitsune <:KitsuneFruit:1487166342497960008> / 5,000 Robux <:e_f5e50c_8142:1487167022658879520>\n> <:e_f8a047_1847:1487164857517342750> <@&1487126328279830710> <:e_f8a047_8717:1487165262863274045> Permanent Dragon <:dragon:1487166379122626723>/ 7,500 Robux <:e_f8a047_8533:1487167066057474069>\n> <:e_faec69_9471:1487164889213567097> <@&1487126329294983294> <:e_faec69_2107:1487165319389778223> All Permanent Fruits <:perm:1487166401797029971> / 10,000 Robux <:e_faec69_1777:1487167121661104199>' },
    { type: 14 },
    { type: 10, content: '<:e_FFAE00_4916:1487105142997127250> EVENT GUIDELINES: <:e_FFAE00_4916:1487105142997127250>\n<:buddha:1487034693651267664> <:wh:1487105260387307580> Inviting alternative accounts to the event is strictly prohibited. <:e_FFAE00_8931:1487105621080801461>\n<:buddha:1487034693651267664> <:wh:1487105260387307580> Failure to follow Discord\'s Terms of Service and Roblox Community Guidelines may result in removal from the event.\n\n<:e_FFAE00_4914:1487106191690698875> CLAIM INFORMATION: <:e_FFAE00_4914:1487106191690698875>\n<:e_FFAE00_2239:1487106767551856640> Once you\'re completed your invites, contact an <@&1479764099607953532> to redeem! <:e_FFAE00_3461:1487107024318894233>' },
    { type: 14 },
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: 'Check Invite', url: 'https://discohook.app', emoji: { name: '👋' } },
        { type: 2, style: 2, custom_id: 'p_284704454815518723', label: 'How to invite?', emoji: { name: '❔' } },
      ],
    },
  );

  await channel.send({
    flags: 32768,
    components: [{ type: 17, accent_color: 16351749, spoiler: false, components: innerComponents }],
  });
}

// WIZARD STATUS EMBED
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

// AUTO-REVOKE SWEEP
async function sweepDeadInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const dead = [...invites.values()]
      .filter(i => i.uses < CONFIG.SWEEP_MIN_USES)
      .sort((a, b) => a.uses - b.uses)
      .slice(0, CONFIG.SWEEP_AMOUNT);
    if (!dead.length) return { swept: 0, codes: [], total: invites.size };
    const codes = [];
    for (const inv of dead) {
      await inv.delete(`Auto-revoke: <${CONFIG.SWEEP_MIN_USES} uses`);
      inviteCache.get(guild.id)?.delete(inv.code);
      codes.push(`\`${inv.code}\` — ${inv.uses} use${inv.uses === 1 ? '' : 's'}`);
    }
    return { swept: codes.length, codes, total: invites.size };
  } catch (err) {
    console.error('Sweep error:', err);
    return { swept: 0, codes: [], total: 0 };
  }
}

// READY
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      const inv = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(inv.map(i => [i.code, i.uses])));
    } catch {}
  }
});

// MEMBER JOIN
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

  setTimeout(() => welcomeMsg.delete().catch(() => {}), 4000);
});

// BUTTONS
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'rules_btn')
    return interaction.reply({ content: settings.rulesChannelId ? `📜 <#${settings.rulesChannelId}>` : '📜 Check the rules channel!', ephemeral: true });
  if (interaction.customId === 'events_btn')
    return interaction.reply({ content: settings.eventChannelId ? `🎁 <#${settings.eventChannelId}>` : '🎁 Check the events channel!', ephemeral: true });
  if (interaction.customId === 'p_284704454815518723')
    return interaction.reply({ content: '📖 **How to invite:**\n1. Server Settings → Invites\n2. Create a link\n3. Share it\n4. Hit your goal, then contact staff to claim!', ephemeral: true });
});

// MESSAGE CREATE
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // Wizard handling
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

  // Normal prefix commands
  if (!message.content.startsWith(CONFIG.PREFIX)) return;

  const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (!memberIsAdmin(message.member))
    return message.reply('❌ You need **Administrator** permission' + (CONFIG.ADMIN_ROLE_ID ? ' or the admin role' : '') + '.');

  if (cmd === 'setwelcome') {
    if (wizards.has(message.author.id)) return message.reply('⚠️ You have an active wizard. Type `cancel` first.');
    wizards.set(message.author.id, { type: 'welcome', step: 0, data: {}, channelId: message.channel.id });
    return message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x5865F2).setTitle('🛠️ Welcome Setup').setDescription(WELCOME_STEPS[0].prompt),
      wizardStatusEmbed(WEL
