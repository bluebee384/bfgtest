const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, Events } = require('discord.js');
const http = require('http');

// ─── RAILWAY KEEP-ALIVE ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot is alive ✅'); }).listen(PORT, () => {
  console.log(`🌐 Keep-alive server on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── CONFIG (from Railway env vars) ────────────────────────────────────────
const CONFIG = {
  TOKEN:              process.env.DISCORD_TOKEN,
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID,
  EVENT_CHANNEL_ID:   process.env.EVENT_CHANNEL_ID,
  PREFIX: '!',
  SWEEP_EVERY_JOINS: 1000,
  SWEEP_MIN_USES:    3,
};

if (!CONFIG.TOKEN) {
  console.error('❌ DISCORD_TOKEN env var is missing.');
  process.exit(1);
}

// ─── RUNTIME SETTINGS (overridden by wizards) ───────────────────────────────
// These start from env vars and can be updated live without redeployment.
const settings = {
  welcomeChannelId: CONFIG.WELCOME_CHANNEL_ID,
  rulesChannelId:   null,
  generalChannelId: null,
  welcomeColor:     0xFFD700,
  welcomeBanner:    null,

  eventChannelId:   CONFIG.EVENT_CHANNEL_ID,
  // Event embed content is fixed to match the screenshot.
  // Only the channel is configurable via !setevent.
};

// ─── INVITE CACHE ───────────────────────────────────────────────────────────
const inviteCache = new Map();
const joinCounter  = new Map();

// ─── ACTIVE WIZARDS ─────────────────────────────────────────────────────────
// Map<userId, { type, step, data, promptMsg }>
const wizards = new Map();

// ─── WIZARD DEFINITIONS ─────────────────────────────────────────────────────
const WELCOME_STEPS = [
  {
    key:    'welcomeChannelId',
    label:  'Welcome Channel',
    prompt: '📌 **Step 1/6 — Welcome Channel**\nMention or paste the ID of the channel where greet messages should appear.\n*Example: `#welcome` or `1234567890`*',
    parse:  v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key:    'rulesChannelId',
    label:  'Rules Channel',
    prompt: '📜 **Step 2/6 — Rules Channel**\nMention or paste the ID of your rules channel.\n*Example: `#rules`*',
    parse:  v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key:    'generalChannelId',
    label:  'General Channel',
    prompt: '💬 **Step 3/6 — General Channel**\nMention or paste the ID of your general chat channel.',
    parse:  v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key:    'welcomeColor',
    label:  'Embed Color',
    prompt: '🎨 **Step 4/6 — Embed Color**\nEnter a hex color for the welcome embed border.\n*Example: `#FFD700` or `FF0000`*\nType `skip` to keep the current color.',
    parse:  v => {
      if (v.toLowerCase() === 'skip') return null;
      const hex = v.replace('#', '');
      const n   = parseInt(hex, 16);
      return isNaN(n) ? null : n;
    },
    optional: true,
  },
  {
    key:    'welcomeBanner',
    label:  'Banner Image URL',
    prompt: '🖼️ **Step 5/6 — Banner Image**\nPaste a direct image URL for the welcome banner (shown at the bottom of the embed).\n*Must start with `https://`*\nType `skip` to leave blank.',
    parse:  v => v.toLowerCase() === 'skip' ? null : v.trim(),
    optional: true,
  },
  {
    key:    '_preview',
    label:  'Preview',
    prompt: '👀 **Step 6/6 — Preview**\nHere\'s a preview of your welcome embed! Reply `confirm` to save or `cancel` to discard.',
    parse:  v => v.trim().toLowerCase(),
    isConfirm: true,
  },
];

const EVENT_STEPS = [
  {
    key:    'eventChannelId',
    label:  'Event Channel',
    prompt: '📌 **Step 1/2 — Event Channel**\nMention or paste the ID of the channel to post the event embed in.\n*Example: `#events` or `1234567890`*',
    parse:  v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key:    '_preview',
    label:  'Preview',
    prompt: '👀 **Step 2/2 — Preview**\nHere\'s exactly how the event embed will look! Reply `confirm` to post it or `cancel` to discard.',
    parse:  v => v.trim().toLowerCase(),
    isConfirm: true,
  },
];

// ─── HELPER: build welcome embed from data ───────────────────────────────────
function buildWelcomeEmbed(member, data, guild) {
  const embed = new EmbedBuilder()
    .setColor(data.welcomeColor ?? 0xFFD700)
    .setTitle(`🌟 Welcome to ${guild.name}!`)
    .setDescription(
      `Hey ${member ?? '**New Member**'}, glad you joined us! 🎉\n\n` +
      `You are member **#${guild.memberCount}**!\n\n` +
      `📜 **Please start by reading the rules** so you know what's allowed.\n` +
      `🎮 Then jump into the community — events, giveaways, and more await!`
    )
    .addFields(
      { name: '📌 Read Rules',    value: data.rulesChannelId   ? `<#${data.rulesChannelId}>`   : '*Not set*', inline: true },
      { name: '🎁 Active Events', value: data.eventChannelId   ? `<#${data.eventChannelId}>`   : '*Not set*', inline: true },
      { name: '💬 General Chat',  value: data.generalChannelId ? `<#${data.generalChannelId}>` : '*Not set*', inline: true },
    )
    .setFooter({ text: `${guild.name} • Have a great time! 🍊`, iconURL: guild.iconURL() })
    .setTimestamp();

  if (data.welcomeBanner) embed.setImage(data.welcomeBanner);
  return embed;
}

// ─── HELPER: build event embed — matches screenshot exactly ─────────────────
function buildEventEmbed(data, guild) {
  const embed = new EmbedBuilder()
    .setColor(0xFF8C00)
    .setTitle('🍊 Summer BloxFruit Event — Event Rewards')
    .setDescription(
      'To celebrate the games activity, we\'ve launched an **OFFICIAL EVENT** where ' +
      'you can earn __FREE__ Permanent fruits & Robux!\n\n' +
      '🏆 This is a `limited-time` event and comes to an end in **2 days** ' +
      '( March 30, 2026 12:00 PM ), so be sure to not miss this opportunity! 🕰️'
    )
    .addFields(
      {
        name: '🎁 EVENT REWARDS: 🎁',
        value:
          '▶ `@role` ═ **Permanent Yeti** 🌀 / 2,500 Robux 🟡\n' +
          '▶ `@role` ═ **Permanent Kitsune** 🌸 / 5,000 Robux 🟡\n' +
          '▶ `@role` ═ **Permanent Dragon** 🐉 / 7,500 Robux 🟡\n' +
          '▶ `@role` ═ **All Permanent Fruits** 🍊 / 10,000 Robux 🟡',
      },
      {
        name: 'ℹ️ EVENT GUIDELINES: ℹ️',
        value:
          '🔑 ▶ Inviting alternative accounts to the event is strictly __prohibited__. 🔨\n' +
          '🔑 ▶ Failure to follow [Discord\'s Terms of Service](https://discord.com/terms) and ' +
          '[Roblox Community Guidelines](https://en.help.roblox.com/hc/en-us/articles/203313410) ' +
          'may result in removal from the event.',
      },
      {
        name: '✉️ CLAIM INFORMATION: ✉️',
        value: '• Once you\'re completed your invites, contact an `@role` to redeem! 🤝',
      },
    )
    .setTimestamp();

  // Banner image if set
  if (data?.eventBanner) embed.setImage(data.eventBanner);
  return embed;
}

// ─── HELPER: build wizard status embed ──────────────────────────────────────
function wizardStatusEmbed(steps, currentStep, data, type) {
  const fields = steps
    .filter(s => s.key !== '_preview')
    .map(s => ({
      name:   s.label,
      value:  data[s.key] != null
                ? (typeof data[s.key] === 'number' ? `#${data[s.key].toString(16).toUpperCase()}` : String(data[s.key]).slice(0, 80))
                : (s.optional ? '*skipped*' : '⏳ pending'),
      inline: true,
    }));

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🛠️ ${type} Setup Wizard`)
    .setDescription(`Step **${currentStep + 1}** of **${steps.length}**\nType \`cancel\` at any time to exit.`)
    .addFields(fields)
    .setFooter({ text: 'Fill in each field as prompted above ↑' });
}

// ─── SWEEP FUNCTION ──────────────────────────────────────────────────────────
async function sweepDeadInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const dead = invites.filter(inv => inv.uses < CONFIG.SWEEP_MIN_USES);
    if (dead.size === 0) return { swept: 0, codes: [] };

    const deletedCodes = [];
    for (const invite of dead.values()) {
      await invite.delete(`Auto-sweep: <${CONFIG.SWEEP_MIN_USES} uses after ${CONFIG.SWEEP_EVERY_JOINS} joins`);
      inviteCache.get(guild.id)?.delete(invite.code);
      deletedCodes.push(`\`${invite.code}\` (${invite.uses} uses)`);
    }
    return { swept: deletedCodes.length, codes: deletedCodes };
  } catch (err) {
    console.error(`Sweep error:`, err);
    return { swept: 0, codes: [] };
  }
}

// ─── READY ───────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
    } catch {}
  }
});

// ─── INVITE EVENTS ───────────────────────────────────────────────────────────
client.on(Events.InviteCreate, invite => {
  const cache = inviteCache.get(invite.guild.id) ?? new Map();
  cache.set(invite.code, invite.uses);
  inviteCache.set(invite.guild.id, cache);
});
client.on(Events.InviteDelete, invite => {
  inviteCache.get(invite.guild.id)?.delete(invite.code);
});

// ─── MEMBER JOIN ─────────────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;
  let usedInvite = null;

  try {
    const newInvites = await guild.invites.fetch();
    const oldCache   = inviteCache.get(guild.id) ?? new Map();
    for (const invite of newInvites.values()) {
      if (invite.uses > (oldCache.get(invite.code) ?? 0)) { usedInvite = invite; break; }
    }
    inviteCache.set(guild.id, new Map(newInvites.map(i => [i.code, i.uses])));

    const count = (joinCounter.get(guild.id) ?? 0) + 1;
    joinCounter.set(guild.id, count);

    if (count % CONFIG.SWEEP_EVERY_JOINS === 0) {
      const { swept, codes } = await sweepDeadInvites(guild);
      const logCh = guild.channels.cache.get(settings.welcomeChannelId);
      if (logCh && swept > 0) {
        await logCh.send({ embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('🧹 Auto-Sweep Complete')
            .setDescription(`Triggered after **${count} total joins**.\nRemoved **${swept}** invite(s) with fewer than **${CONFIG.SWEEP_MIN_USES} uses**:\n\n${codes.join('\n')}`)
            .setTimestamp()
        ]});
      }
    }
  } catch (err) { console.error('Invite tracking error:', err); }

  const welcomeChannel = guild.channels.cache.get(settings.welcomeChannelId);
  if (!welcomeChannel) return;

  const inviterText = usedInvite?.inviter
    ? `Invited by **${usedInvite.inviter.tag}** using code \`${usedInvite.code}\` (${usedInvite.uses} uses)`
    : 'Invite source unknown';

  const embed = buildWelcomeEmbed(member, settings, guild);
  // append inviter info to description
  embed.setDescription(embed.data.description + `\n\n> *${inviterText}*`);
  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('📜 Read Rules').setStyle(ButtonStyle.Primary).setCustomId('rules_btn'),
    new ButtonBuilder().setLabel('🎮 Active Events').setStyle(ButtonStyle.Success).setCustomId('events_btn'),
  );

  await welcomeChannel.send({ content: `👋 Welcome ${member}!`, embeds: [embed], components: [row] });
});

// ─── BUTTON INTERACTIONS ──────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  const { customId } = interaction;
  if (customId === 'rules_btn')
    return interaction.reply({ content: settings.rulesChannelId ? `📜 Head to <#${settings.rulesChannelId}> and give them a read!` : '📜 Check the rules channel!', ephemeral: true });
  if (customId === 'events_btn')
    return interaction.reply({ content: settings.eventChannelId ? `🎁 Check out <#${settings.eventChannelId}> for active events!` : '🎁 Check the events channel!', ephemeral: true });
  if (customId === 'check_invite')
    return interaction.reply({ content: '🔍 Use `!invites` to check invite stats, or DM a staff member!', ephemeral: true });
  if (customId === 'how_to_invite')
    return interaction.reply({ content: '📖 **How to Invite:**\n1. Go to **Server Settings → Invites**\n2. Create an invite link\n3. Share it with friends!\n4. Contact `@role` once done to claim your reward!', ephemeral: true });
});

// ─── MESSAGE COMMANDS ─────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // ── WIZARD REPLY HANDLER (runs before prefix check) ──────────────────────
  const wizard = wizards.get(message.author.id);
  if (wizard && message.channel.id === wizard.channelId) {
    const steps = wizard.type === 'welcome' ? WELCOME_STEPS : EVENT_STEPS;
    const step  = steps[wizard.step];

    // Cancel anytime
    if (message.content.trim().toLowerCase() === 'cancel') {
      wizards.delete(message.author.id);
      await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Setup Cancelled').setDescription('No changes were saved.').setTimestamp()
      ]});
      return;
    }

    // ── CONFIRM STEP ────────────────────────────────────────────────────────
    if (step.isConfirm) {
      const answer = step.parse(message.content);
      if (answer !== 'confirm') {
        wizards.delete(message.author.id);
        await message.channel.send({ embeds: [
          new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Setup Cancelled').setDescription('No changes were saved.').setTimestamp()
        ]});
        return;
      }

      // Save wizard data into settings
      Object.assign(settings, wizard.data);
      wizards.delete(message.author.id);

      if (wizard.type === 'welcome') {
        await message.channel.send({ embeds: [
          new EmbedBuilder().setColor(0x57F287).setTitle('✅ Welcome Settings Saved!').setDescription('The welcome embed has been updated. New members will see the new layout.').setTimestamp()
        ]});
      } else {
        // Post the event embed
        const eventCh = message.guild.channels.cache.get(wizard.data.eventChannelId ?? settings.eventChannelId);
        if (!eventCh) {
          return message.channel.send('⚠️ Settings saved but could not find the event channel to post in.');
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('✅ Check Invite').setStyle(ButtonStyle.Success).setCustomId('check_invite'),
          new ButtonBuilder().setLabel('❓ How to Invite?').setStyle(ButtonStyle.Secondary).setCustomId('how_to_invite'),
        );
        await eventCh.send({ embeds: [buildEventEmbed(settings, message.guild)], components: [row] });
        await message.channel.send({ embeds: [
          new EmbedBuilder().setColor(0x57F287).setTitle('✅ Event Posted!').setDescription(`Event embed posted in <#${eventCh.id}> and settings saved.`).setTimestamp()
        ]});
      }
      return;
    }

    // ── NORMAL STEP ─────────────────────────────────────────────────────────
    const parsed = step.parse(message.content);

    // Validate non-optional fields can't be blank
    if (!parsed && !step.optional) {
      await message.channel.send(`⚠️ That doesn't look right. Please try again for **${step.label}**.`);
      return;
    }

    // Save parsed value (skip if optional and null)
    if (parsed !== null) wizard.data[step.key] = parsed;

    wizard.step++;

    // If we just hit the preview step, show the preview embed
    const nextStep = steps[wizard.step];
    if (nextStep?.isConfirm) {
      const previewEmbed = wizard.type === 'welcome'
        ? buildWelcomeEmbed(null, { ...settings, ...wizard.data }, message.guild)
        : buildEventEmbed({ ...settings, ...wizard.data }, message.guild);

      await message.channel.send({
        embeds: [
          new EmbedBuilder().setColor(0x5865F2).setDescription(nextStep.prompt),
          previewEmbed,
          wizardStatusEmbed(steps, wizard.step, { ...settings, ...wizard.data }, wizard.type === 'welcome' ? 'Welcome' : 'Event'),
        ]
      });
      return;
    }

    // Normal next step
    if (wizard.step >= steps.length) {
      wizards.delete(message.author.id);
      return;
    }

    await message.channel.send({
      embeds: [
        new EmbedBuilder().setColor(0x5865F2).setDescription(steps[wizard.step].prompt),
        wizardStatusEmbed(steps, wizard.step, { ...settings, ...wizard.data }, wizard.type === 'welcome' ? 'Welcome' : 'Event'),
      ]
    });
    return;
  }

  // ── PREFIX COMMANDS ────────────────────────────────────────────────────────
  if (!message.content.startsWith(CONFIG.PREFIX)) return;

  const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
  const cmd  = args.shift().toLowerCase();

  const requirePerm = () => {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      message.reply('❌ You need **Manage Server** permission to use this.');
      return false;
    }
    return true;
  };

  // ── !setwelcome ────────────────────────────────────────────────────────────
  if (cmd === 'setwelcome') {
    if (!requirePerm()) return;
    if (wizards.has(message.author.id)) return message.reply('⚠️ You already have an active setup wizard. Type `cancel` to exit it first.');

    wizards.set(message.author.id, { type: 'welcome', step: 0, data: {}, channelId: message.channel.id });

    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🛠️ Welcome Setup Wizard')
        .setDescription('Let\'s set up your welcome embed! I\'ll walk you through each field one by one.\n\nType `cancel` at any step to exit without saving.\n\n' + WELCOME_STEPS[0].prompt),
      wizardStatusEmbed(WELCOME_STEPS, 0, settings, 'Welcome'),
    ]});
  }

  // ── !setevent ──────────────────────────────────────────────────────────────
  if (cmd === 'setevent') {
    if (!requirePerm()) return;
    if (wizards.has(message.author.id)) return message.reply('⚠️ You already have an active setup wizard. Type `cancel` to exit it first.');

    wizards.set(message.author.id, { type: 'event', step: 0, data: {}, channelId: message.channel.id });

    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setColor(0xFF8C00)
        .setTitle('🛠️ Event Setup Wizard')
        .setDescription('Let\'s set up your event embed! I\'ll walk you through each field one by one.\n\nType `cancel` at any step to exit without saving.\n\n' + EVENT_STEPS[0].prompt),
      wizardStatusEmbed(EVENT_STEPS, 0, settings, 'Event'),
    ]});
  }

  // ── !revoke <code> ─────────────────────────────────────────────────────────
  if (cmd === 'revoke') {
    if (!requirePerm()) return;
    const code = args[0];
    if (!code) return message.reply('❌ Usage: `!revoke <invite_code>`');
    try {
      const invite = await message.guild.invites.fetch(code);
      await invite.delete(`Manually revoked by ${message.author.tag}`);
      inviteCache.get(message.guild.id)?.delete(code);
      return message.reply({ embeds: [
        new EmbedBuilder().setColor(0xFF4444).setTitle('🔒 Invite Revoked')
          .addFields(
            { name: 'Code', value: `\`${code}\``, inline: true },
            { name: 'Uses', value: `${invite.uses}`, inline: true },
            { name: 'Revoked By', value: message.author.tag, inline: true },
          ).setTimestamp()
      ]});
    } catch {
      return message.reply(`❌ Could not find or revoke invite \`${code}\`.`);
    }
  }

  // ── !invites ───────────────────────────────────────────────────────────────
  if (cmd === 'invites') {
    if (!requirePerm()) return;
    try {
      const invites = await message.guild.invites.fetch();
      if (!invites.size) return message.reply('No active invites found.');
      const sorted = [...invites.values()].sort((a, b) => b.uses - a.uses).slice(0, 10);
      const desc   = sorted.map((inv, i) => `**${i + 1}.** \`${inv.code}\` — **${inv.uses}** uses — by ${inv.inviter?.tag ?? 'Unknown'}`).join('\n');
      return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Top Active Invites').setDescription(desc).setTimestamp()] });
    } catch {
      return message.reply('❌ Could not fetch invites.');
    }
  }
});

client.login(CONFIG.TOKEN);
