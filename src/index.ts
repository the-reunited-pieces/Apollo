import { Client, Events } from "discord.js";
import "dotenv/config.js";
import moment from "moment-timezone";
import assert from "node:assert";
import { commands } from "./commands.ts";
import { handleDump } from "./commands/dump.ts";
import { trpc } from "./trpc.ts";

assert(process.env.ALERT_CHANNEL_ID, "Set ALERT_CHANNEL_ID in .env!");
assert(process.env.DEXCOM_ADVANCE_ALERTS_ROLE_ID, "Set DEXCOM_ADVANCE_ALERTS_ROLE_ID in .env!");
assert(process.env.DEXCOM_ALERTS_ROLE_ID, "Set DEXCOM_ALERTS_ROLE_ID in .env!");

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

const errorMap: Record<string, string> = {
    auth: "there was an authentication-related issue likely requiring running `node login.ts` again (this may be caused by access token expiry due to repeated failed refreshes, a 401/403 from the Dexcom server, etc.).",
    dexcom: "fetching from the requested API endpoint resulted in a non-OK status from Dexcom that does not indicate an authentication failure.",
    parse: "the requested API endpoint returned an OK status, but the data could not be parsed as JSON or failed zod validation (check the `dexcom-api` logs for more details).",
};

const client = new Client({ intents: 0 });

const promise = new Promise<Client<true>>((res) => client.on(Events.ClientReady, res));
await client.login(process.env.DISCORD_TOKEN);
const bot = await promise;

console.log(`Bot started as ${bot.user.tag}`);

const alerts = await bot.channels.fetch(process.env.ALERT_CHANNEL_ID).catch(() => null);
if (!alerts?.isSendable()) throw "Alert channel is not a valid and text-like (sendable) channel!";

process.on("uncaughtException", (error) => {
    console.error(error);
    sendAlert(`A fatal exception occurred! Please check the console for more details: ${error}`, "advance");
});

async function sendAlert(message: string, alert: "advance" | "ping" | "silent") {
    if (!alerts?.isSendable()) return; // Not really possible...
    console.log(`[APOLLO] Sending alert (alert = ${alert}): ${message}`);
    await alerts
        .send(
            `${alert === "silent" ? "" : `<@&${alert === "advance" ? process.env.DEXCOM_ADVANCE_ALERTS_ROLE_ID : process.env.DEXCOM_ALERTS_ROLE_ID}> `}${message}`,
        )
        .catch((error) => console.error(`[APOLLO] Error sending alert: ${error}`));
}

bot.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "dump") {
            await handleDump(interaction);
        }
    }
});

await bot.application.commands.set(commands);
let lastSync: number | null = null;
let eventThreshold: number = Date.now();
let pingCooldown = new Set<string>();
let currentlyOutOfRange = false;

function checkPing(category: string) {
    if (pingCooldown.has(category)) return false;
    pingCooldown.add(category);
    setTimeout(() => pingCooldown.delete(category), 15 * 60 * 1000);
    return true;
}

async function loop() {
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

    const options = { start: Math.max(start, end - 24 * 60 * 60 * 1000), end };
    console.log(`[APOLLO] Syncing with data range ${new Date(options.start).toISOString()} to ${new Date(options.end).toISOString()}.`);

    const { error: egvsError, value: egvs, sandbox } = await trpc.egvs.query(options);
    console.log(`[APOLLO] Fetched EGVS (error = ${egvsError}), processing data into updates/alerts now.`);

    const { error: eventsError, value: events } = await trpc.events.query(options);
    console.log(`[APOLLO] Fetched events (error = ${eventsError}), processing data into updates/alerts now.`);

    lastSync = Date.now();

    await Promise.all([
        (async () => {
            const channel = await bot.channels.fetch(process.env.STATDOCK_ID!).catch(() => null);
            if (!channel || channel.isDMBased()) return;

            const record = egvs?.records[0];
            if (!egvsError && !record) return;

            channel.setName(
                egvsError
                    ? `Error: ${egvsError}`
                    : `${record!.valueInMmoll?.toFixed(1)} ${trendArrows[record!.trend!]} [${moment(record!.systemTime).tz(process.env.TIMEZONE!).format("HH:mm")}] ${sandbox ? "(sandbox data)" : ""}`,
            );
        })(),
        (async () => {
            if (egvsError) return sendAlert(`Fetching the latest estimated glucose value (EGV) records failed: ${errorMap[egvsError] ?? egvsError}`, "advance");

            const record = egvs!.records[0];
            if (!record) return;
            if (record.valueInMmoll === undefined) return sendAlert("The latest record did not contain a glucose value!", "advance");

            const glucose = record.valueInMmoll;
            const rate = record.rateInMmollmin ?? 0;

            if (glucose <= 4) {
                currentlyOutOfRange = true;

                if (glucose + rate * 30 <= 4) {
                    if (checkPing("low")) {
                        sendAlert(
                            `Glucose is **low** (**${glucose.toFixed(1)}** <= 4.0 mmol/L) and is not projected to return to in range within 30 minutes at the current rate (${rate.toFixed(2)} mmol/L/min).`,
                            "ping",
                        );
                    }
                } else {
                    if (checkPing("low-but-recovering")) {
                        sendAlert(
                            `Glucose is **low** (**${glucose.toFixed(1)}** <= 4.0 mmol/L), though it is projected to return to in range within 30 minutes at the current rate (at ${rate.toFixed(2)} mmol/L/min, it would be ${(glucose + rate * 30).toFixed(1)} mmol/L after 30 minutes).`,
                            "advance",
                        );
                    }
                }
            } else if (glucose >= 14) {
                currentlyOutOfRange = true;

                if (glucose + rate * 30 >= 14) {
                    if (checkPing("high")) {
                        sendAlert(
                            `Glucose is **high** (**${glucose.toFixed(1)}** >= 14.0 mmol/L) and is not projected to return to in range within 30 minutes at the current rate (${rate.toFixed(2)} mmol/L/min).`,
                            "ping",
                        );
                    }
                } else {
                    if (checkPing("high-but-recovering")) {
                        sendAlert(
                            `Glucose is **high** (**${glucose.toFixed(1)}** >= 14.0 mmol/L), though it is projected to return to in range within 30 minutes at the current rate (at ${rate.toFixed(2)} mmol/L/min, it would be ${(glucose + rate * 30).toFixed(1)} mmol/L after 30 minutes).`,
                            "advance",
                        );
                    }
                }
            } else if (glucose + rate * 30 <= 4) {
                if (checkPing("impending-low")) {
                    sendAlert(
                        `Glucose may be low soon (currently **${glucose.toFixed(1)}** > 4.0 mmol/L, but at the current rate of ${rate.toFixed(2)} mmol/L/min, it would be ${(glucose + rate * 30).toFixed(1)} mmol/L after 30 minutes).`,
                        "advance",
                    );
                }
            } else if (glucose + rate * 30 >= 14) {
                if (checkPing("impending-high")) {
                    sendAlert(
                        `Glucose may be high soon (currently **${glucose.toFixed(1)}** < 14.0 mmol/L, but at the current rate of ${rate.toFixed(2)} mmol/L/min, it would be ${(glucose + rate * 30).toFixed(1)} mmol/L after 30 minutes).`,
                        "advance",
                    );
                }
            } else if (currentlyOutOfRange) {
                currentlyOutOfRange = false;
                sendAlert(
                    `Glucose is back to within range (4.0 < **${glucose.toFixed(1)}** < 14.0 mmol/L) and not projected to be out of range within 30 minutes!`,
                    "silent",
                );
            } else {
                console.log(
                    `[APOLLO] Nothing to alert. EGV is ${glucose.toFixed(1)} mmol/L and 30-minute projection is ${(glucose + rate * 30).toFixed(1)} mmol/L based on the rate of ${rate.toFixed(2)} mmol/L/min.`,
                );
            }
        })(),
        (async () => {
            if (eventsError) return sendAlert(`Fetching the latest event records failed: ${errorMap[eventsError] ?? eventsError}`, "advance");

            const filtered = events!.records
                .map((record) => ({
                    time: new Date(record.systemTime),
                    id: record.recordId,
                    type: record.eventType,
                    subtype: record.eventSubType,
                    status: record.eventStatus,
                    value: record.value,
                    unit: record.unit,
                }))
                .filter((record) => record.time.getTime() > eventThreshold)
                .toSorted((x, y) => x.time.getTime() - y.time.getTime());

            for (const { time, id, type, subtype, status, value, unit } of filtered) {
                const ts = Math.floor(time.getTime() / 1000);
                await sendAlert(
                    `<t:${ts}:f> (<t:${ts}:R>) (ID = \`${id}\`): An event was ${status}: ${
                        type === "bloodGlucose"
                            ? `Blood glucose measured via finger prick as ${(+value / 18).toFixed(1)} mmol/L.`
                            : type === "carbs"
                              ? `${(+value).toFixed(1)} gram${+value === 1 ? "" : "s"} of carbs consumed.`
                              : type === "exercise"
                                ? `${+value} minute${+value === 1 ? "" : "s"} of ${subtype} exercise.`
                                : type === "health"
                                  ? `Health record added: ${subtype} — ${value}.`
                                  : type === "insulin"
                                    ? `${+value} unit${+value === 1 ? "" : "s"} of ${
                                          {
                                              fastActing: "fast-acting",
                                              longActing: "long-acting",
                                          }[subtype ?? ""] ?? subtype
                                      } insulin taken.`
                                    : `[Unknown event! type/subtype = ${type}/${subtype}, value = ${value}, unit = ${unit}]`
                    }`,
                    "silent",
                );
            }

            eventThreshold = Date.now();
        })(),
    ]);
}

loop();
setInterval(loop, 5 * 60 * 1000);
