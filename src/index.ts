import { Client, Events } from "discord.js";
import { commands } from "./commands.ts";
import { handleDump } from "./commands/dump.ts";
import { trpc } from "./trpc.ts";

const trendArrows: Record<string, string> = {
    doubleUp: "⇈",
    singleUp: "↑",
    fortyFiveUp: "↗",
    flat: "→",
    fortyFiveDown: "↘",
    singleDown: "↓",
    doubleDown: "⇊",
    none: "⋯",
    notComputable: "✗",
    rateOutOfRange: "‼",
};

const client = new Client({ intents: 0 });

const promise = new Promise<Client<true>>((res) => client.on(Events.ClientReady, res));
await client.login(process.env.DISCORD_TOKEN);
const bot = await promise;

console.log(`Bot started as ${bot.user.tag}`);

bot.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "dump") {
            await handleDump(interaction);
        }
    }
});

await bot.application.commands.set(commands);
let lastSync: number | null = null;

async function sync() {
    const channel = await bot.channels.fetch(process.env.STATDOCK_ID!).catch(() => null);
    if (channel === null || channel.isDMBased()) return;

    const { start, end } = lastSync
        ? { start: lastSync, end: Date.now() + 24 * 60 * 60 * 1000 }
        : ((await trpc.dataRange
              .query()
              .then(({ error, value }) => (error ? null : value?.egvs))
              .then((value) =>
                  value
                      ? {
                            start: new Date(value.start.systemTime + "Z").getTime(),
                            end: new Date(value.end.systemTime + "Z").getTime(),
                        }
                      : null,
              )
              .catch(() => null)) ?? {
              start: Date.now() - 24 * 60 * 60 * 1000,
              end: Date.now() + 24 * 60 * 60 * 1000,
          });

    const { error, value } = await trpc.egvs.query({
        start: Math.max(start, end - 30 * 60 * 60 * 1000),
        end,
    });
    const record = value?.records.at(-1);

    channel.setName(error ? `Error: ${error}` : `${Math.round(record!.valueInMmoll! * 10) / 10} ${trendArrows[record!.trend!]}`);
}

sync();
