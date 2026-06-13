require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { buildCommands } = require("./src/commands");

const token = String(process.env.DISCORD_TOKEN || "").trim();
const clientId = String(process.env.CLIENT_ID || "").trim();
const guildId = String(process.env.GUILD_ID || "").trim();

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

const commands = buildCommands().map((command) => command.toJSON());
const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands
      });
      console.log(`Registered ${commands.length} guild command(s) to ${guildId}.`);
      return;
    }

    await rest.put(Routes.applicationCommands(clientId), {
      body: commands
    });
    console.log(`Registered ${commands.length} global command(s).`);
  } catch (error) {
    console.error("Failed to deploy commands:", error);
    process.exit(1);
  }
})();
