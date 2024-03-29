import { Services } from "../../db/entities/Subscriber";
import { SendMessageOpts, ServiceInterface } from "../_interface";
import { VK as VKIO, MessageContext, APIError, VKError } from "vk-io";
import { HearManager } from "@vk-io/hear";
import { chatIn, error, info, warning } from "../../libs/logger";
import { chunk } from "lodash";
import repository from "../../db/repository";
import { command } from "../../decorators/command";
import { startVKCommand } from "../../commands/startVK";
import { helpCommand } from "../../commands/help";
import { subscribeCommand } from "../../commands/subscribe";
import { unsubscribeCommand } from "../../commands/unsubscribe";
import { getTimeTableCommand } from "../../commands/get-timeTable";
import { getPairsForWeekCommand } from "../../commands/get-pairs-weekly";
import { getLinkCommand } from "../../commands/get-link";

class VK extends ServiceInterface {
  bot: VKIO;
  hearManager: HearManager<MessageContext>;

  constructor() {
    super({
      service: Services.VK,
    });
  }

  async init() {
    const token = process.env.VK_GROUP_TOKEN;
    if (!token) {
      warning("VK: group token not setuped, library will not works.");
      return;
    }

    try {
      this.bot = new VKIO({ token });
      this.hearManager = new HearManager<MessageContext>();

      this.bot.updates.on("message", async (ctx, next) => {
        if (!ctx.isUser) return;
        if (ctx.text) await this.ensureUser(ctx);
        await this.listener(ctx);
        next();
      });
      this.bot.updates.on("message_new", this.hearManager.middleware);

      await this.bot.updates.start();
      info("VK Service initialized.");
      this.inited = true;
    } catch (e) {
      error(e);
    }
  }

  async ensureUser(ctx: MessageContext) {
    const sub = await repository.getVkSubscriber(ctx.senderId.toString());
    ctx.sub = sub;
  }

  async listener(ctx: MessageContext) {
    if (!ctx.hasText) return;
    const commandName = ctx.text;

    const command = this.commands.find((c) => commandName.match(c.filter));
    if (!command) {
      await this["notFound"](ctx);
      return;
    }

    try {
      await this[command.fnc](ctx);
    } catch (e) {
      if (e instanceof VKError) {
        ctx.send({
          message: "Ошибка на стороне Вконтакте. Попробуйте позже.",
        });
      }
      ctx.send({
        message: "Внутренняя ошибка серевера. Мы уже работаем над этим.",
      });
      error(e);
    }
    return true;
  }

  @command(/^\/broadcast\s?(.*)$/im, {
    description: "Отправить сообщение всем пользователям",
  })
  async broadcast(ctx: MessageContext) {
    const adminsIds = process.env.VK_BOT_ADMINS.split(",");

    if (!adminsIds.includes(ctx.peerId.toString())) {
      await this.sendMessage({
        target: ctx.peerId,
        message: "Вы не можете использовать эту команду",
      });
      return;
    }

    const broadcastText = ctx.text.slice("/broadcast".length).trim();

    if (!broadcastText) {
      await this.sendMessage({
        target: ctx.peerId,
        message: "Неверное использование команды, необоходимо ввести текст",
      });
      return;
    }

    const subs = await repository.getServiceSubscribers(Services.VK);
    for (const sub of subs) {
      await this.sendMessage({
        target: sub.chatId,
        message: broadcastText,
      });
    }
  }

  @command(/^\/start$/i, { description: "Начать пользоваться ботом" })
  async start(ctx: MessageContext) {
    const { message, kb } = startVKCommand();

    ctx.send({
      message: message,
      keyboard: kb,
    });
  }

  @command(/^\/help$/i, { description: "Помощь" })
  async help(ctx: MessageContext) {
    const { message } = helpCommand();

    ctx.send({
      message,
    });
  }

  @command(/^Помощь$/i, { description: "Помощь" })
  async help2(ctx: MessageContext) {
    const { message } = helpCommand();

    ctx.send({
      message,
    });
  }

  @command(/^⌚️ Звонки$/i, {
    description: "Получить расписание занятий",
  })
  async getRings(ctx: MessageContext) {
    const { message } = getTimeTableCommand();

    ctx.send({
      message: message,
    });
  }

  @command(/^Звонки$/i, {
    description: "Получить расписание занятий",
  })
  async getRings2(ctx: MessageContext) {
    const { message } = getTimeTableCommand();

    ctx.send({
      message: message,
    });
  }

  @command(/^Подпиши на \S+$/i, {
    description: "Подписывает на изменения расписания группы",
  })
  async newSub(ctx: MessageContext) {
    const text = ctx.text;

    const parts = text.split(" ");
    if (parts.length != 3) {
      ctx.send({
        message: "Неверное использование команды.",
      });
      return;
    }

    const groupName = parts[2];
    const sub = await repository.getVkSubscriber(ctx.peerId.toString());

    const { message } = await subscribeCommand({
      sub: sub,
      chatId: ctx.peerId,
      groupName: groupName,
      service: Services.VK,
    });

    ctx.send({
      message: message,
    });
  }

  @command(/^Забудь меня$/i, {
    description: "Отписывает вас от получения уведомлений о расписании",
  })
  async deleteMe(ctx: MessageContext) {
    const sub = await repository.getVkSubscriber(ctx.peerId.toString());
    const { message } = await unsubscribeCommand({
      sub: sub,
    });

    ctx.send({
      message: message,
    });
  }

  @command(/^Скачать$/i, {
    description: "Получить ссылку на расписание для вашего факультета",
  })
  async getLink(ctx: MessageContext) {
    const sub = await repository.getVkSubscriber(ctx.peerId.toString());
    const { message } = getLinkCommand(sub);
    ctx.send({ message: message });
  }

  @command(/^💾 Скачать$/i, {
    description: "Получить ссылку на расписание для вашего факультета",
  })
  async getLink2(ctx: MessageContext) {
    const sub = await repository.getVkSubscriber(ctx.peerId.toString());
    const { message } = getLinkCommand(sub);
    ctx.send({ message: message });
  }

  @command(/^Пары на неделю$/i, {
    description: "Возвращает пары на неделю, если пользователь уже подписан",
  })
  async getWeekPairsForSub(ctx: MessageContext) {
    const sub = await repository.getVkSubscriber(ctx.peerId.toString());
    if (!sub) {
      ctx.send({
        message: "Сначала подпишитесь.",
      });
      return;
    }

    const { messages } = await getPairsForWeekCommand(sub);
    if (!messages.length) {
      await ctx.send({
        message: "Нет информации о парах на неделю",
      });
      return;
    }
    for (const message of messages) {
      await ctx.send({
        message: message,
      });
    }
  }

  async notFound(ctx: MessageContext) {
    ctx.send({
      message: "Я вас не понимаю.",
    });
  }

  public async sendMessage(opts: SendMessageOpts) {
    const targets = Array.isArray(opts.target) ? opts.target : [opts.target];
    const chunks = chunk(
      targets.map((t) => Number(t)),
      100,
    );
    const attachment = opts.image
      ? await this.uploadPhoto(opts.image)
      : undefined;
    for (const chunk of chunks) {
      await this.bot.api.messages.send({
        random_id: Math.random() * (1000000000 - 9) + 10,
        user_ids: chunk,
        message: opts.message,
        dont_parse_links: true,
        attachment,
      });
    }
  }

  async uploadPhoto(source: string) {
    return await this.bot.upload.messagePhoto({
      source: {
        value: source,
      },
    });
  }
}

export default new VK();
